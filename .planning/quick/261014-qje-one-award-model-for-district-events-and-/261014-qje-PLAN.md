---
phase: quick-261014-qje
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  # Task 1 (build and score; nothing committed, saved as a patch)
  - scripts/scoreAwardModel.ts
  - scripts/scoreAwardModel.test.ts
  - scripts/measureAwardSlate.ts
  - scripts/measureAwardSlate.test.ts
  - packages/core/districts/awardSlate.ts
  - packages/core/districts/awardSlate.test.ts
  - packages/core/districts/dcmpAwardSlate.ts
  - packages/core/districts/dcmpAwardSlate.test.ts
  - packages/core/districts/ledgerSimulation.ts
  - packages/core/districts/ledgerSimulation.test.ts
  - .planning/quick/261014-qje-one-award-model-for-district-events-and-/261014-qje-before-snapshot.json
  - .planning/quick/261014-qje-one-award-model-for-district-events-and-/261014-qje-before-score.txt
  - .planning/quick/261014-qje-one-award-model-for-district-events-and-/261014-qje-measure.txt
  - .planning/quick/261014-qje-one-award-model-for-district-events-and-/261014-qje-after-snapshot.json
  - .planning/quick/261014-qje-one-award-model-for-district-events-and-/261014-qje-after-score.txt
  # Task 2 (wire every caller, remove the per team model; nothing committed, saved as a patch)
  - packages/core/districts/awardBaseRates.ts
  - packages/core/districts/awardBaseRates.test.ts
  - packages/core/districts/awardOrderingTables.ts
  - packages/core/districts/awardOrderingTables.test.ts
  - packages/core/districts/dcmpAwardEligibility.ts
  - packages/core/districts/dcmpAwardEligibility.test.ts
  - packages/harness/districtBake.ts
  - packages/harness/districtBake.test.ts
  - packages/harness/districtDcmpAwardInputs.ts
  - packages/harness/districtDcmpAwardInputs.test.ts
  - apps/web/src/components/districts/dcmpAwardInputs.ts
  - apps/web/src/components/districts/districtLedgerRows.ts
  - apps/web/src/components/districts/districtLedgerRows.test.ts
  - apps/web/src/components/districts/districtRunAssembly.ts
  - apps/web/src/components/districts/useSimulatedDcmpBake.ts
  - apps/web/src/components/districts/useDistrictLedgerData.test.ts
  - apps/web/src/components/districts/useDistrictLedgerData.asOf.test.ts
  - apps/web/src/components/districts/champLedgerChances.test.ts
  - apps/web/src/workers/districtAsOfJob.ts
  - apps/web/src/workers/districtAsOfJob.test.ts
  - apps/web/src/workers/districtSimulationProtocol.ts
  - apps/web/src/workers/districtSimulationProtocol.test.ts
  - apps/web/src/workers/districtWorkerGraph.test.ts
  - scripts/asOfRewindWeb.test.ts
  - scripts/publishDistricts.ts
  - scripts/publishDistricts.test.ts
  - scripts/measureDistrictAwardBaseRates.ts
  - scripts/measureDistrictAwardBaseRates.test.ts
  - scripts/measureAwardOrderingTables.ts
  - scripts/measureAwardOrderingTables.test.ts
  - scripts/measureDcmpAwardSlate.ts
  - scripts/measureDcmpAwardSlate.test.ts
  - package.json
  - .planning/quick/261014-qje-one-award-model-for-district-events-and-/261014-qje-suite-census.txt
  # Task 2, the Champ Locks cutoff draws on the slate (Jacob, 2026-10-14)
  - packages/core/districts/hypotheticalDcmp.ts
  - packages/core/districts/hypotheticalDcmp.test.ts
  - packages/core/districts/champCutoffTuning.generated.ts
  - packages/core/districts/dcmpHistory.generated.ts
  - apps/web/src/components/districts/champLedgerChances.ts
  - apps/web/src/components/districts/ChampLocksLedger.tsx
  - apps/web/src/components/districts/champLedgerRows.test.ts
  - scripts/measureChampCutoff.ts
  - scripts/measureChampCutoff.test.ts
  - scripts/measureLocksInRange.ts
  - .planning/quick/261014-qje-one-award-model-for-district-events-and-/261014-qje-champ-cutoff-before.txt
  - .planning/quick/261014-qje-one-award-model-for-district-events-and-/261014-qje-champ-cutoff-after.txt
  # Task 3 (ship prep, only after Jacob approves; commits)
  - packages/harness/pageArtifacts.ts
  - packages/harness/pageArtifacts.test.ts
  - packages/core/districts/awardModelVersion.test.ts
  - apps/web/src/components/methodology/districtLedgerContent.ts
  - apps/web/src/components/methodology/districtLedgerContent.test.ts
  - apps/web/src/components/methodology/awardsContent.ts
  - apps/web/src/components/methodology/awardsContent.test.ts
autonomous: false
requirements:
  - QJE-01-one-award-model-both-tiers
  - QJE-02-season-award-list
  - QJE-03-decoration-feature
  - QJE-04-impact-signal
  - QJE-05-eligibility-per-tier
  - QJE-06-pre-registered-pass-bar
  - QJE-07-ship-prep-after-approval

estimate:
  tokens: 410000
  raw_tokens: 820000
  tasks: 3
  confidence: high

must_haves:
  truths:
    - "Every district event and every DCMP tier event whose awards are not posted is priced by ONE award slate model (packages/core/districts/awardSlate.ts): per award slot an expected count at the event, shared among the teams who can win it by measured class lifts with a capped water fill, the highest single award kept (Q-01, Q-08)"
    - "A slot's count follows the season actually priced: it sums only the award types on that season's declared list, so a retired award (Rookie Inspiration from 2025) adds nothing and a season with no declared list is refused, never defaulted (Q-03, Q-04)"
    - "Rookie only awards live in their own slots, so Rookie Inspiration's history never leaks into the open judged awards' rookie weight (Q-02, Q-06)"
    - "A team's decoration count is one definition at both tiers and on the published artifact: distinct wins of the 18 point paying team award types over every earlier award season (Q-09)"
    - "Impact is weighted by the Impact order's two keys (prior Impact wins, then decorations), and a team that already won Impact, Engineering Inspiration or Rookie All Star at an earlier district event that season gets exactly 0 of that award at a later district event (Q-05, Q-06)"
    - "The Champ Locks cutoff draws pick DCMP Impact, Engineering Inspiration and Rookie All Star winners, and each open district event's entrant, with the slate's own class weights and the same eligibility the DCMP slate reads; no separate champ weighting exists and the tuning grid's weighting knob is gone (Q-11)"
    - "The pass bar below was fixed before any scoring; the scored result reaches Jacob before anything is committed; nothing is tuned against 2023 to 2026"
    - "No award prediction reaches locks.ts or moves a Locked or Locked out verdict"
    - "After Jacob approves, the published district artifact names the award model (awardModelVersion 2.0.0) and both methodology pages describe the slate with figures from the AFTER run only"
  artifacts:
    - path: packages/core/districts/awardSlate.ts
      provides: "slot map, declared season award lists, measured tables for both tiers, district eligibility, district slate builder, slate assignments, slate odds, slateEntrantWeight"
    - path: scripts/measureAwardSlate.ts
      provides: "the one measurement script for both tiers: censuses, per type counts, class lifts, literal blocks; the corpus helpers moved from the three deleted scripts"
    - path: scripts/scoreAwardModel.ts
      provides: "BEFORE and AFTER snapshots, the pass bar gates, per season rookie lines, new class view, Impact Brier, district eligibility audit"
    - path: .planning/quick/261014-qje-one-award-model-for-district-events-and-/261014-qje-before-snapshot.json
      provides: "the shipped model's scores the pass bar reads"
    - path: packages/core/districts/awardModelVersion.test.ts
      provides: "digest of the slot map, season lists and slate tables pinned to DISTRICT_AWARD_MODEL_VERSION (Task 3)"
  key_links:
    - from: scripts/scoreAwardModel.ts
      to: packages/core/districts/awardSlate.ts
      via: "the scorer builds every district slate with buildDistrictAwardSlate and districtAwardEligibility and every DCMP slate with buildDcmpAwardSlate, then reads eventAwardOutcomeOdds, so it scores exactly what ships"
      pattern: "buildDistrictAwardSlate|buildDcmpAwardSlate"
    - from: apps/web/src/components/districts/districtRunAssembly.ts
      to: apps/web/src/components/districts/dcmpAwardInputs.ts
      via: "every district and DCMP tier request (live, as of real, as of generated, simulated DCMP bake) carries a slate built at the same position"
      pattern: "districtAwardSlateAt|dcmpAwardSlateAt"
    - from: scripts/publishDistricts.ts
      to: scripts/measureAwardSlate.ts
      via: "the published priorJudgedAwards comes from the same priorDecorationCount helper the lifts were measured with"
      pattern: "priorDecorationCount"
    - from: packages/core/districts/dcmpAwardEligibility.ts
      to: packages/core/districts/awardSlate.ts
      via: "every candidate and entrant weight (champ draws, DCMP slate pending chance, district eligibility) is slateEntrantWeight; dcmpEntrantWeight and the weighting knob are deleted"
      pattern: "slateEntrantWeight"
    - from: apps/web/src/components/districts/champLedgerChances.ts
      to: packages/core/districts/dcmpAwardEligibility.ts
      via: "buildChampAwardDraws maps dcmpAwardEligibility's slate weighted candidates and entrants onto the champ draws"
      pattern: "dcmpEligibilityAt"
---

<objective>
Jacob, 2026-10-14: ONE award model for district events and DCMPs. Today district events are priced by a per team model (base rate tables, Impact and Rookie All Star ordering tables, a residual rate) and DCMPs by the per event slate of 261014-i8i. This plan moves district events onto the slate, generalised so one module, one measurement script and one scorer price both tiers. The only tier differences are who can win each award, where the three DCMP qualifying award counts come from (the champ draws' count model, unchanged), and the DCMP role split. Jacob, 2026-10-14, later the same day: the Champ Locks cutoff draws join the same model too (Q-11), so no separate champ weighting remains.

Purpose: the per team model cannot follow FIRST's award list or the field (the mii candidates all failed for that reason: Rookie Inspiration overstated 2025 and 2026 rookies about 3x, stacks priced as Impact, individual awards counted as decoration, a residual that double counted "no award"). The slate fixes those by construction, and it is judged on a pass bar fixed below before any scoring.

Output: a scored, uncommitted patch for Jacob (Tasks 1 and 2), then, only after he approves, the commit with a version stamp and methodology copy (Task 3).

Shape: three sequential tasks fixed by the orchestrator. Task 1 builds the model and scores it; Task 2 wires every caller and removes the per team model; Task 3 ships after approval. Tracer first is set aside on purpose: the decisive question is the score, and the scorer is the end to end path.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.claude/CLAUDE.md
@.planning/STATE.md
@.planning/quick/261014-mii-district-award-odds-decoration-drift-sta/261014-mii-SUMMARY.md
@.planning/quick/261014-mii-district-award-odds-decoration-drift-sta/261014-mii-before-score.txt
@.planning/quick/261014-mii-district-award-odds-decoration-drift-sta/patches/rookie-census.txt
@.planning/quick/261014-mii-district-award-odds-decoration-drift-sta/patches/season-award-census.txt
@.planning/quick/261014-i8i-dcmp-award-pricing-eligibility-dcmp-rate/261014-i8i-SUMMARY.md
@packages/core/districts/dcmpAwardSlate.ts  (the model being generalised: roles, waterFill, buildDcmpAwardSlate, dcmpSlateAssignments, slateAwardOutcomeOdds)
@packages/core/districts/dcmpAwardEligibility.ts  (the one eligibility helper; its pending formula is reused for district eligibility)
@scripts/measureDcmpAwardSlate.ts  (measurement pattern: corpus loaders, championship grouping, lift accumulators, literal block)
@scripts/scoreAwardModel.ts  (the scorer, snapshots, gates)
Read only the ranges needed, using Grep for line numbers: packages/core/districts/ledgerSimulation.ts (DistrictAwardProfile ~L339, resolveEventAwardPricing ~L583, eventAwardOutcomeOdds ~L706, DistrictLedgerEventInput ~L780, award resolution in simulateDistrictEvent ~L1562, drawAwardPoints ~L1879), packages/core/districts/awardBaseRates.ts (DISTRICT_POINT_AWARD_VALUES ~L145, decorationBucket, cellKey, rookieStateFor), scripts/publishDistricts.ts (buildSeasonAwardContext ~L1085, bakeSeason ~L1500 to L1730, dcmpBakeAwardSlate ~L1700), apps/web/src/components/districts/districtRunAssembly.ts (foldDcmpSlate ~L77, dcmpSlateMember ~L92), apps/web/src/workers/districtSimulationProtocol.ts (isDcmpAwardSlate ~L366).

PLANNER CENSUS, 2026-10-14 (a scratch read of data/corpus.sqlite; informational, NOT a source of literals; the committed script reprints all of it):
- District tier, teams winning the SAME award at two district events in one season: Impact 1 (2020 only), Engineering Inspiration 0 and Rookie All Star 0 in every season 2019 to 2026 (1 each in some of 2016 to 2018). Cross awards are common: 124 team seasons (2019 on) won Impact at one district event and Engineering Inspiration at another.
- Impact winners with a later district event that season: 46, 48, 51, 57 (2023 to 2026). The shipped model prices those later events as if the team could win Impact again.
- Award winning teams per district event barely move with field size (2023 to 2026: 13.9 at 20 to 29 teams, 14.3 at 30 to 39, 14.7 at 40 or more), so a fixed count per event is right.
- Shipped base rate tables: 2016 to 2018 team events are 8,214 of the 15,855 rows the 2023 table was fit on (52%); in 2016 every team reads "none" because the corpus holds no earlier season.
- FIRST 2025 award update (community.firstinspires.org/award-updates-for-the-2025-season): Rookie Inspiration retired because "having rookie-only awards does not help recognize all new teams"; Rising All Star is open to any team, aimed at young teams, and optional per event.

CONCURRENT SESSIONS: main checkout, no worktree (the corpus is local and gitignored). 261014-ol6 is active (the weighted pick draft) and is likely to touch packages/core/districts/ledgerSimulation.ts, apps/web/src/components/districts/districtRunAssembly.ts, districtLedgerRows.ts and scripts/publishDistricts.ts. Every task starts with a clean file precondition and returns BLOCKED naming the file otherwise. Never `git add -A` or `git add .`; Task 3 stages by explicit path only.

THE WORKER'S IMPORT GRAPH includes packages/core/districts/awardBaseRates.ts, awardOrderingTables.ts (through hypotheticalDcmp.ts's two point constants), hypotheticalDcmp.ts, champCutoffTuning.generated.ts, dcmpHistory.generated.ts and packages/harness/pageArtifacts.ts. Task 2 strips dead tables from the first two, removes the weighting knob from hypotheticalDcmp.ts and regenerates the tuning module, and Task 3 adds a schema field to pageArtifacts.ts, so a Worker deploy is owed at ship (main context, Jacob's go ahead). The Worker reads no award weighting, so its behavior does not change.

THE CHAMP CUTOFF BACKTEST (scripts/measureChampCutoff.ts) reads composed district artifacts from data/local-publish/districts, which other sessions also read. This plan never writes there: Task 2 composes fresh artifacts into SCRATCH with the publisher's offline dry run (`--dry-run` reads nothing from R2 unless `--check-live` is passed) and points the backtest at them with a new `--dir` option. The backtest re selects its tuning walk forward inside every run; `--write-tuning` writes the module the browser uses; `--check-history` must then report no drift.
</context>

<pre_registered_model>
Fixed now, before any scoring. None of it may change in response to a score. Q ids are this plan's decision ids; cite them in code comments and commits.

Q-01 ONE MODEL. Every event whose awards are not posted, at either tier, carries an award slate: per slot an expected count at this event and each team's chance of being allowed to win. One module (packages/core/districts/awardSlate.ts) holds the slot map, the declared season lists, the measured tables for both tiers, the district eligibility, the district slate builder, the assignments, the odds and the class weights; packages/core/districts/dcmpAwardSlate.ts keeps only what is DCMP specific (roles, buildDcmpAwardSlate, its target error) and imports the rest. One measurement script (scripts/measureAwardSlate.ts) and one scorer. Counts and lifts are measured per tier from that tier's own events, because a district event and a DCMP give different numbers of awards to differently chosen fields; the slots, classes, fallbacks, training rule, assignment and draw are identical. The tier differences are exactly: who can win (Q-05), the source of the DCMP Impact, Engineering Inspiration and Rookie All Star counts (dcmpAwardCountDistribution times the event's share, unchanged from 261014-i8i, so the DCMP row and Champ Locks agree), and the DCMP roles (single, division, finals, wholeChampionship, unchanged). The Champ Locks cutoff draws are a third reader of the same model (Q-11).

Q-02 SLOTS, in pricing order:
- impact: 10 points, any team.
- engineeringInspiration: 8 points, veterans only. No rookie has won it at either tier in 2016 to 2026 (the 261014-i8i census), and the Awards drawer already shows Engineering Inspiration only for a veteran.
- rookieAllStar: 8 points, rookies only.
- judgedRookie: 5 points, rookies only. Type 15 Rookie Inspiration, which FIRST ran as a rookie only award.
- judged: 5 points, any team. Every other point paying team award.
"Veteran" means not a rookie: the unknown rookie state counts as a veteran for audiences, exactly as the DCMP slate does today. The slot of each award type is a fixed map, TYPE_SLOT, whose keys equal DISTRICT_POINT_AWARD_VALUES' keys and whose slot points equal each type's value, pinned by equality. A type a declared list names but TYPE_SLOT lacks is refused.

Q-03 THE DECLARED SEASON AWARD LIST. SEASON_AWARD_TYPES maps each award season (2016 to 2020 and 2022 to 2026) to the point paying types FIRST gave that season. It must equal the corpus census of point paying types won at district tier events that season (corpus guarded test; the mii census already shows 18 retired after 2020, 22 after 2022, 15 after 2024, 71 added 2019, 82 added 2023, 83 added 2025). A season with no entry throws UnknownSeasonAwardListError: refused, never defaulted. 2027 must be declared from FIRST's published list before the first 2027 event (follow up, beside the existing re measure follow up).

Q-04 HOW MANY. For each type the priced season declares, at a tier and role: the mean number of distinct winners of that type per event, counting only winners inside the type's audience who were eligible there, over the events whose field holds at least one eligible audience member, in the most recent earlier season whose list declares the type and that holds measured events of that tier and role. This is the 261014-i8i judged anchor rule applied per type. DCMP fallback when a role has no earlier season: the pooled single plus division events of the most recent earlier season holding either (as today). A slot's count is the sum over its declared types. Excluded from the counts: the three DCMP qualifying awards (Q-01). wholeChampionship sums the 5 point counts of the district's single and division keys (single's when there are none), as today. Rule source names: role, pooled, new-award.

Q-05 WHO CAN WIN.
- District event E: impact any attendee; engineeringInspiration any veteran; rookieAllStar and judgedRookie any rookie; judged any attendee. AND a team that already won Impact, Engineering Inspiration or Rookie All Star at an EARLIER district event that season cannot win that same award at E (planner census above; cross awards stay open). Earlier means a strictly smaller TBA competition week (the `week` the corpus events table and the artifact both carry); a null week on either event is never earlier, and the census prints how many team events that affects. When an earlier event's awards are final at the position, holding the award makes the chance 0. When they are still open, the chance the team is still allowed is the product over its open earlier events of (1 minus its weight over that event's total weight), the same pending formula dcmpAwardEligibility uses, with weights from slateEntrantWeight (Q-06). Implemented as districtAwardEligibility in awardSlate.ts: call dcmpAwardEligibility over only the district events earlier than E (every team's districtEventKeys filtered to them) and take 1 minus dcmpEligibilityChance per award type.
- DCMP tier: Impact, Engineering Inspiration and Rookie All Star exactly as dcmpAwardEligibility's rule says today (held at a final district event, or the pending chance), within the audience; from Task 2 its weights are slateEntrantWeight (Q-11), which leaves every scored value unchanged because the scorer has every award final; the 5 point slots open to their audience at that key. Roles as today: a division gives 5 point awards only, a finals the three qualifying awards only, a single both, wholeChampionship both.
- The slate's eligibility list: at a DCMP role it lists teams with a chance above 0 (absent means 0, as today); at the district role it lists every award field member (absent is a typed refusal).

Q-06 WHO GETS THEM (class lifts). A team's weight in a slot is the measured lift of its class.
- impact class: `${decorationBucket(priorImpactWins)}|${decorationBucket(priorJudgedAwards)}`, the Impact order's two keys (prior Impact wins first, decorations second). Primary rung: the prior Impact win bucket pooled.
- every other slot: cellKey(decorationBucket(priorJudgedAwards), rookieState). Primary rung: the decoration bucket pooled.
- Fallback: cell, then primary pooled, then slot pooled (lift 1), reported with AwardBaseRateSource's three rung names. Bar: MIN_CELL_OBSERVATIONS (100) observations.
- A lift is won over expected, as today: in each pool, e is the pool's winners over its size and y is whether the team won; lift is the sum of y over the sum of e.
- Pools: district tier, one per event; DCMP qualifying slots, one per championship (union of its keys, as today); DCMP 5 point slots, one per single or division key. A pool holds the slot's eligible audience minus every team that won an award of an earlier slot there, so "won nothing higher" is never counted twice. y is "won any type of the slot there"; a 5 plus 5 stack is one 5 point win.
- All or nothing: an award field in which any profile lacks either count prices every team at lift 1 (slot pooled rung), as the DCMP slate does today.
- slateEntrantWeight(season, tier, awardType, profile): 0 outside the award's audience, else the class lift of the award's slot (Impact, Engineering Inspiration, Rookie All Star). Field free, so the eligibility helper can call it per team.

Q-07 TRAINING SEASONS. Lifts for season Y at a tier come from every earlier season that holds measured events of that tier and has at least three award seasons in the corpus before it (2019 on; 2021 is not an award season). Why: 2016 has no earlier award season (every team reads none), 2017 one, 2018 two; they were 52% of the shipped 2023 table's rows and pull every class toward the field average. Three is MIN_PRIOR_DISTRICT_SEASONS, the history the shipped registration bar asked for. Expected: district 2023 from 2019, 2020 and 2022; DCMP 2023 from 2019 and 2022 (2020's championships fail the degenerate filter). Registered seasons: 2023 to 2026 at both tiers, pinned by equality.

Q-08 THE PRICE. For each slot in Q-02 order: cap_j = q_j times room_j (room starts at 1; q_j is 0 outside the audience, else the Q-05 chance for the three qualifying awards and 1 for the 5 point slots); weight_j = lift_j times cap_j; t = waterFill(weights, caps, slot count); room_j decreases by t_j. Outcomes: p10 = t_impact; p8 = t_engineeringInspiration + t_rookieAllStar; p5 = t_judgedRookie + t_judged; p0 = the room left. The assignment keeps today's shape (impact = p10, eight = p8 over (1 minus p10), judged = p5 over (1 minus p10 minus p8), 0 where a denominator is 0), so slateAwardOutcomeOdds and the slate draw in simulateDistrictEvent are unchanged. Never a stack; the Impact row is the Impact draw by construction. One stated change at the DCMP: the 8 point fill now uses the room left after Impact, so every slot delivers its count exactly.

Q-09 DECORATION FEATURE. A team's decoration count for season Y, published under the existing wire name priorJudgedAwards: distinct (season, event, type) wins of the 18 point paying team award types (DISTRICT_POINT_AWARD_VALUES) at any event in the corpus, over EVERY award season strictly before Y (no window). One helper, priorDecorationCount, feeds the measurement, the scorer and the publisher. priorImpactWins is unchanged (distinct (season, event) Impact wins before Y). Why this, chosen before scoring: it drops the individual awards (Dean's List, Woodie Flowers, Volunteer, Wildcard, Impact Finalist); it keeps the long history the three season window threw away (the mii windowed candidates under predicted the long decorated class by 6.3 points); and drift now hurts far less, because a lift only shares out a count fixed per event (drift can move shares inside a field, never the total), and Q-07 drops the seasons with too little history to mean anything.

Q-10 NEW AWARD PRIOR. A type the priced season declares that no earlier season declared (82 in 2023, 83 in 2025): its count is the mean count of the season's other declared types with the same points at that tier and role (source new-award); its winners come from its slot's lifts. Why: FIRST lists it as one more award for the same audience, so the only measured evidence of how often such an award is given, and to whom, is the slot's other awards; nothing is invented, nothing is fit to its own first season. It is one award of about fourteen in the judged slot, so its effect on any team is small. From its second season its own count is measured and its winners enter the slot's lifts. Rising All Star's stated aim at young teams is a lean the model cannot see in its first season; gate 3 is where that would show.

Q-11 THE CHAMP LOCKS CUTOFF DRAWS USE THE SLATE (Jacob, 2026-10-14). buildChampAwardDraws picks DCMP Impact, Engineering Inspiration and Rookie All Star winners from the same slot model and the same eligibility the DCMP slate uses. No separate champ weighting remains:
- Every weight dcmpAwardEligibility hands out is slateEntrantWeight of the award's slot. A held candidate (who wins at the DCMP) weighs its DCMP tier class lift; an entrant at an open district event (who wins there) weighs its district tier class lift. A season with no slate tables at that tier weighs the audience (0 or 1), which is what every currently uniform season already did.
- The Q-05 no repeat rule applies inside the helper too: an entrant at an open district event who already holds that same award at a final district event weighs 0 there. One rule, so the DCMP slate's pending chance, the district eligibility and the champ draws all read it.
- dcmpEntrantWeight and the champ tuning grid's weighting knob (K1, uniform or decoration) are deleted. ChampCutoffSetting keeps countMode (K2) and spreadScale (K3), and the grid becomes 2 times 5 = 10 settings in the same order. The DCMP slate keeps reading setting.countMode for its qualifying award counts, so the champ draws and the DCMP row still share one count model.
- How the two read the same weights: the DCMP slate turns them into per team chances with the capped water fill; the champ draws draw a count from the same count model and pick that many winners with the same weights, because qualification is a joint event. With one award to give and every candidate held, the two agree exactly (a Task 2 test).
- Every knob left (K2, K3) is re selected walk forward by measureChampCutoff --write-tuning on freshly composed artifacts; the module is the script's own printed output. The champ cutoff numbers are REPORTED before and after for Jacob, not gated, and nothing is tuned to them beyond the existing walk forward selection.

Q-12 REMOVED (Task 2). The per team model: the base rate tables and their lookup, the ordering and residual tables and their lookups, the ordering assignment and base rate paths in ledgerSimulation.ts, the {1, 2, 14} exclusion set, the decoration window helpers from 39664d5a, the three old measurement scripts and their package.json entries, dcmpEntrantWeight and the champ weighting knob (Q-11), and the two award blocks in published district artifacts (the schema keeps both as optional fields so an older artifact still parses). Kept as shared vocabulary: buckets, rookie state, cellKey, DISTRICT_POINT_AWARD_VALUES, AWARD_POINT_SUPPORT and its index helper, the award point constants and the fold helpers the drawer still reads. awardOrderingTables.ts keeps its name because hypotheticalDcmp.ts (Worker import graph) imports its two point constants. Published profiles: every season whose corpus holds at least three award seasons before it and whose earlier award rows are not empty (2019 on, the same set as today).

Q-13 VERSION (Task 3). DISTRICT_AWARD_MODEL_VERSION = "2.0.0" in awardSlate.ts (an artifact without the stamp carries the per team model); optional top level awardModelVersion on DistrictArtifactSchema; the publisher writes it whenever it writes a profile; a digest test pins TYPE_SLOT, SEASON_AWARD_TYPES, DISTRICT_POINT_AWARD_VALUES and the slate tables to the version.
</pre_registered_model>

<pass_bar>
## PASS BAR (Jacob approves this before anything runs)

Scored with `npx tsx scripts/scoreAwardModel.ts --before <BEFORE snapshot>`: walk forward 2023 to 2026, exact odds, the same team events the shipped model is scored on (district 14,016, DCMP 3,438). The BEFORE snapshot is rerun on today's code first and must match the shipped numbers exactly (district digest 494ac134...). Every line must pass. A changed team event count anywhere is a fail.

1. District any award Brier below the shipped 0.2039.
2. Class calibration. In each class, the gap between said and happened must be inside the class's chance wobble, or smaller than the shipped gap. The wobble is two standard errors of what happened, 2 × √(h × (1 − h) / n), from the class's own happened rate h and size n: about 1.1 points for three or more, 1.4 for one or two, 1.6 for none and 3.3 for none rookie. Classes: the four review classes under the frozen review rule, and the same four under the new decoration count. Why a wobble: "happened" is a sample too. The last bar ("every gap smaller") failed every candidate on three or more, whose shipped gap of 0.8 was already inside its 1.1 wobble. Teams at one event move together, so the real wobble is wider; this one is the strict side.
3. Rookies in 2025 and in 2026, each season on its own: gap and Brier no worse than shipped.
4. The Impact row equals the Impact draw (within 1e-9).
5. The Impact signal is kept: the district Impact Brier (did this team win Impact) is no worse than shipped.
6. DCMP any award Brier no worse than 0.1909.
7. Exactly zero where an award cannot go: DCMP Impact, Engineering Inspiration and Rookie All Star on ineligible teams; district Impact, Engineering Inspiration and Rookie All Star on a team that already won that same award at an earlier district event that season.

Reported, not gated: reliability bins, Brier per season, mean award points, expected and real winners per award slot, Impact said against real wins.

If any line fails, nothing is retried or changed against 2023 to 2026. Jacob gets the scored patch and both outputs.

Approved by Jacob 2026-10-14 before any scoring.
</pass_bar>

<patch_protocol>
Tasks 1 and 2 commit NOTHING. Each ends by saving its whole change outside the repo and restoring the tree. SCRATCH = C:/Users/Jacob/AppData/Local/Temp/claude/c--Users-Jacob-Documents-GitHub-SigmaScout/be51d953-3960-492b-8782-6284eee2208a/scratchpad
1. Run `git status --short`. List every path this task created, modified or deleted. Confirm each modified path's hunks are this task's own (`git diff -- <path>`); another session's dirty file is never included and never touched.
2. `git add --intent-to-add -- <new paths>`, then at once `git diff HEAD --binary -- <every touched path> > SCRATCH/<name>.patch`, then at once `git reset --quiet -- <new paths>`. Copy every saved output (scores, snapshots, measure output, suite census) to SCRATCH as well.
3. Restore: `git checkout HEAD -- <modified and deleted tracked paths>`; delete the new files.
4. Prove: `git status --short` lists none of the touched paths, and `git apply --check SCRATCH/<name>.patch` succeeds on the restored tree. Report the patch path, its size and its file list.
Re applying (Tasks 2 and 3): `git apply --check` first; if it fails, return BLOCKED with its output. Never `git stash` (it would take other sessions' work).
</patch_protocol>

<caller_inventory>
| Caller | Uses today | Moves? |
|---|---|---|
| packages/core/districts/ledgerSimulation.ts | base rate path, ordering path, DCMP slate path | Task 1: accepts a district slate; Task 2: slate required at both tiers, old paths deleted (Q-12) |
| packages/core/districts/dcmpAwardSlate.ts | DCMP tables, waterFill, assignments | Task 1: DCMP builder on the shared tables and slots; the rest moves to awardSlate.ts |
| packages/core/districts/dcmpAwardEligibility.ts | dcmpEntrantWeight (uniform or base rate decoration) | Task 2: dcmpEntrantWeight deleted; every weight is slateEntrantWeight; held award entrants weigh 0 (Q-11) |
| packages/core/districts/awardBaseRates.ts, awardOrderingTables.ts | tables, lookups, vocabulary | Task 2: tables and lookups deleted, vocabulary kept (Q-12) |
| packages/core/districts/hypotheticalDcmp.ts | two point constants; ChampCutoffSetting and the 20 setting grid | Task 2: weighting knob removed, grid of 10 (Q-11) |
| packages/core/districts/champCutoffTuning.generated.ts, dcmpHistory.generated.ts | generated by measureChampCutoff | Task 2: tuning regenerated by --write-tuning; history only if --check-history shows drift |
| apps/web/src/components/districts/champLedgerChances.ts (buildChampAwardDraws), ChampLocksLedger.tsx | champ setting with weighting | Task 2: slate weighted draws (Q-11); ChampLocksLedger.tsx only if it reads the knob |
| scripts/measureChampCutoff.ts | the champ cutoff backtest and the two generated modules | Task 2: new `--dir` option, grid without the knob, BEFORE and AFTER runs |
| scripts/measureLocksInRange.ts | champ draws | Task 2: compile only; printed figures may move (follow up) |
| scripts/scoreAwardModel.ts | shipped resolution, gates | Task 1: report additions, pass bar gates, both slates |
| scripts/measureDistrictAwardBaseRates.ts, measureAwardOrderingTables.ts, measureDcmpAwardSlate.ts | per team tables, DCMP tables, corpus helpers | Task 2: deleted; helpers move to scripts/measureAwardSlate.ts |
| scripts/publishDistricts.ts | profiles, award blocks, district and DCMP bakes | Task 2: priorDecorationCount, no award blocks, district bake slates, profile season rule (Q-12) |
| packages/harness/districtBake.ts, districtDcmpAwardInputs.ts | DCMP slate param, artifact to eligibility teams | Task 2: one slate param; event weeks for district eligibility |
| apps/web dcmpAwardInputs.ts, districtRunAssembly.ts, districtLedgerRows.ts, useSimulatedDcmpBake.ts, workers/districtAsOfJob.ts, workers/districtSimulationProtocol.ts | DCMP slate only | Task 2: every request carries a slate; signature and validation |
| apps/web districtLedgerOutcomes.ts, DistrictLedger.tsx | outcome rows, profiles | NO code change |
| packages/harness/pageArtifacts.ts | profile and award block schema | Task 3: awardModelVersion and profile docs |
| scripts/measureAwardPredictability.ts | its own study feature | NO (a separate published study) |
| scripts/measureDistrictCutoff.ts | published artifacts, simulateDistrictEvent | NO code change; printed figures may move after the republish (follow up) |
| packages/core/districts/locks.ts | none | NO, and nothing new may import it |
</caller_inventory>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Build the one award slate, measure it, and score it against the pass bar (patch saved, tree restored)</name>
  <precondition>`git diff --quiet HEAD --` succeeds for scripts/scoreAwardModel.ts, scripts/scoreAwardModel.test.ts, packages/core/districts/dcmpAwardSlate.ts, packages/core/districts/dcmpAwardSlate.test.ts, packages/core/districts/ledgerSimulation.ts and packages/core/districts/ledgerSimulation.test.ts; none of scripts/measureAwardSlate.ts, scripts/measureAwardSlate.test.ts, packages/core/districts/awardSlate.ts, packages/core/districts/awardSlate.test.ts exists; data/corpus.sqlite exists. Otherwise return BLOCKED naming the path.</precondition>
  <files>scripts/scoreAwardModel.ts, scripts/scoreAwardModel.test.ts, scripts/measureAwardSlate.ts, scripts/measureAwardSlate.test.ts, packages/core/districts/awardSlate.ts, packages/core/districts/awardSlate.test.ts, packages/core/districts/dcmpAwardSlate.ts, packages/core/districts/dcmpAwardSlate.test.ts, packages/core/districts/ledgerSimulation.ts, packages/core/districts/ledgerSimulation.test.ts, and in .planning/quick/261014-qje-one-award-model-for-district-events-and-/: 261014-qje-before-snapshot.json, 261014-qje-before-score.txt, 261014-qje-measure.txt, 261014-qje-after-snapshot.json, 261014-qje-after-score.txt</files>
  <read_first>packages/core/districts/dcmpAwardSlate.ts (whole), packages/core/districts/dcmpAwardEligibility.ts (whole), scripts/measureDcmpAwardSlate.ts (whole), scripts/scoreAwardModel.ts (whole), ledgerSimulation.ts ranges named in the context, the mii before score text</read_first>
  <behavior>
    - priorDecorationCount counts distinct (season, event, type) wins whose type is a DISTRICT_POINT_AWARD_VALUES key, any event, every season before the priced one: a Dean's List, Woodie Flowers, Volunteer, Wildcard or Impact Finalist win never counts, a Safety win in 2019 counts for 2026, a win in the priced season never counts.
    - TYPE_SLOT equals the Q-02 map by equality; SEASON_AWARD_TYPES' seasons equal [2016, 2017, 2018, 2019, 2020, 2022, 2023, 2024, 2025, 2026]; an undeclared season throws UnknownSeasonAwardListError; 15 is declared in 2024 and absent in 2025; 83 is absent in 2024 and declared in 2025.
    - districtAwardEligibility: a team holding Impact from a final earlier week district event gets Impact chance 0 and keeps Engineering Inspiration open; holding it from a later week event, a same week event or a null week event changes nothing; an open earlier event with weights 1 of 4 gives 0.75; two open earlier events (1 of 4, 1 of 2) give 0.375.
    - slateAssignments (Q-08): each slot's expected winners equal its count when caps allow; a rookie gets 0 Engineering Inspiration, a veteran 0 Rookie All Star and 0 judgedRookie; a team with Impact chance 0 by eligibility gets p10 exactly 0; a season list without type 15 gives judgedRookie count 0 and therefore no rookie only 5 point mass; p10 + p8 + p5 + p0 = 1 for every team; the DCMP slate with judgedRookie 0 and no room effect reproduces the old dcmpSlateAssignments output on its existing fixtures within 1e-12 except where the Q-08 8 point room rule applies.
    - buildDistrictAwardSlate sums declared type counts per slot, uses the Q-10 prior for a first season type and names it; buildDcmpAwardSlate keeps every 261014-i8i role rule.
    - simulateDistrictEvent at the district tier with a district slate draws from it (per team Monte Carlo frequencies within 4 standard errors of eventAwardOutcomeOdds at 20,000 draws; an ineligible team's histogram has zero mass at the award's points); without a slate the district path is byte identical to HEAD in this task.
    - Measurement leak tests: adding a season Y event leaves Y's counts and lifts unchanged; a team's counts never read season Y; a later week award never makes an earlier event's team ineligible.
    - Corpus guarded (existsSync plus an explicit it.skip): re measuring every registered season and tier reproduces every committed count and lift within 1e-9 and every n exactly; SEASON_AWARD_TYPES equals the census for every corpus season; rookie Engineering Inspiration winners are 0 at both tiers; repeat Engineering Inspiration and Rookie All Star winners at the district tier are 0 for every season 2019 on; the point value cross check prints 0 mismatches; the training seasons per registered season and tier equal the printed lists, pinned by equality.
    - Scorer: snapshots with the new optional fields round trip; each pass bar gate passes and fails on hand built reports exactly at its boundary (gate 2 at the wobble and at the shipped gap, the n mismatch fail, gate 3 per season, gate 7 at one unit of mass); without --before the three 261014-i8i gates are unchanged.
  </behavior>
  <action>
Implements Q-01 to Q-10 and the pass bar (the slate core, the measurement, the scorer). Nothing commits. The old district paths stay in place in this task so the rest of the tree keeps working; Task 2 removes them.

STEP 1, BEFORE (report only, must change no odds). Create scripts/measureAwardSlate.ts with priorDecorationCount (Q-09), importing the existing corpus helpers (loadAwardInstances, loadRookieYears, priorImpactWinCount) from the old scripts for now. In scripts/scoreAwardModel.ts add, report only: a new class view per scored team event (classLabel of decorationBucket(priorDecorationCount) and the rookie state); per season any award accumulators and per season rookie accumulators (rookie state rookie, district tier); a district Impact accumulator (Brier of odds.impact against won Impact, the sums, real wins); a district eligibility audit (for each team event, whether the team held Impact, Engineering Inspiration or Rookie All Star from an earlier week district event that season, all awards final, and the Impact, veteran 8 point and rookie 8 point mass on those team events); a per slot expected against real winners report (district tier, real winners mapped through TYPE_SLOT by highest award). Extend the snapshot schema with these as OPTIONAL fields so the committed mii snapshot still parses. Replace the --before gate set with the seven pass bar gates exactly as written in the pass_bar block (gate 2 wobble = 2 times the square root of h(1 minus h) over n from the BEFORE class; pass when the AFTER gap is at most the wobble or strictly below the BEFORE gap; gates 3, 5 and 6 compare with less or equal; gate 1 strictly below; any missing BEFORE field FAILS); every gate prints GATE PASS or GATE FAIL; any FAIL sets exit code 1. Leave the default mode's three 261014-i8i gates unchanged. Update the header comment. Tests per the behavior block. Run from the repo root: `npx tsx scripts/scoreAwardModel.ts --expect-district-digest 494ac134703547235b1a049ef9ff8e9983af3e508a6672accc605a5d48e45d65 --write-snapshot .planning/quick/261014-qje-one-award-model-for-district-events-and-/261014-qje-before-snapshot.json --label BEFORE`, saving the full printed output as 261014-qje-before-score.txt in the same directory. Confirm by reading the printed lines and with a node one liner comparing the new snapshot to .planning/quick/261014-mii-district-award-odds-decoration-drift-sta/261014-mii-before-snapshot.json: three GATE PASS lines, the same district digest, district n, Brier, said, happened and review classes, the same DCMP n and Brier. Any difference: STOP and return BLOCKED with the output (the baseline does not reproduce).

STEP 2, THE CORE. Create packages/core/districts/awardSlate.ts (pure, browser safe, zero I/O, never imports locks.ts) holding: the slot ids and order (Q-02); TYPE_SLOT; SEASON_AWARD_TYPES (filled in step 4) and UnknownSeasonAwardListError; the measured table types for both tiers (per season: per role per type counts with source, fromSeason and events; per slot the cell and primary lift records with n) and AWARD_SLATE_TABLES between the markers `// BEGIN GENERATED: measureAwardSlate` and `// END GENERATED: measureAwardSlate`; per tier registered season lists derived from the table keys; UnknownAwardSlateSeasonError (tier named in the message) and hasAwardSlateTables; waterFill moved from dcmpAwardSlate.ts unchanged; the class key and fallback lookup (Q-06); slateEntrantWeight; districtAwardEligibility (Q-05); the AwardSlateInput type (role district or a DCMP role; expected counts for all five slots; sources; eligibility per Q-05); buildDistrictAwardSlate; slateAssignments generalising dcmpSlateAssignments per Q-08 (keep the DcmpSlateAssignment shape, renamed as a shared type, and its judged rung in judgedSource); slateAwardOutcomeOdds moved unchanged; MissingSlateProfileError moved. Rewrite packages/core/districts/dcmpAwardSlate.ts to keep roles, buildDcmpAwardSlate (now filling judgedRookie and judged from the per type DCMP counts of Q-04), UnknownDcmpSlateTargetError, and re exports so every current importer compiles unchanged: waterFill, slateAwardOutcomeOdds, DcmpAwardSlateInput as an alias of AwardSlateInput, DCMP_AWARD_SLATE_SEASONS as the DCMP tier's registered list, and UnknownDcmpAwardSlateSeasonError as an alias of UnknownAwardSlateSeasonError (so the web's instanceof catches keep working). In ledgerSimulation.ts add an optional awardSlate to EventAwardPricingInput and DistrictLedgerEventInput: a district role slate at the district tier prices through slateAssignments with disposition "district-slate"; at the dcmp tier awardSlate or the existing dcmpAwardSlate prices as today ("dcmp-slate"); a role that does not match the tier, or both fields at once, is a typed refusal before any draw; a district tier input with no slate keeps the old path unchanged in this task. Update the DCMP slate fixtures in dcmpAwardSlate.test.ts and ledgerSimulation.test.ts to the five count shape, each with a one line comment citing Q-08. Add awardSlate.test.ts per the behavior block plus a source test (CRLF normalised to LF first) that awardSlate.ts imports nothing whose specifier ends in locks.js.

STEP 3, THE MEASUREMENT. Make scripts/measureAwardSlate.ts the one measurement script for both tiers, in measureDcmpAwardSlate.ts's style (pure functions over in memory rows, corpus loaders, a main guarded on being the entry point, printed literal blocks). District tier events: district_rankings entries whose own district_cmp is false, events with award rows, fields of at least 11 (the scorer's population rule), event weeks from the corpus events table. DCMP tier: the championship grouping, role rules and degenerate filter copied from measureDcmpAwardSlate.ts. Eligibility with every award final: district per Q-05 (earlier week holders), DCMP through dcmpAwardEligibility as today. Print, in order: the point value cross check (DISTRICT_POINT_AWARD_VALUES summed over a team's distinct types against TBA's award_points, mismatch count), the SEASON AWARD LIST census per season and tier, the audience census per type and tier (rookie and veteran winners; veteran winners of rookie only types are listed and left out of counts and pools), the repeat winner census (same award at two district events in a season, per type and season), the null week census, then per tier and registered season: the training seasons (Q-07), every per type count with its source (Q-04, Q-10), every class lift with n, won and expected, and every class below the bar printed CANNOT BE SCORED. Then the literal blocks for SEASON_AWARD_TYPES and AWARD_SLATE_TABLES. measureAwardSlate.test.ts per the behavior block.

STEP 4, LITERALS. Run `npx tsx scripts/measureAwardSlate.ts` from the repo root and save the full printed output as 261014-qje-measure.txt in the quick directory. Write both literal blocks into awardSlate.ts PROGRAMMATICALLY with a throwaway transform script kept in SCRATCH (replace between the markers), never by hand. Rerun the measurement test; its corpus guarded describe must RUN (not skip) and pass.

STEP 5, THE SCORER ON THE SLATE. In scoreAwardModel.ts build profiles with priorDecorationCount (priorJudgedAwards) and priorImpactWinCount; build every district tier event's slate with districtAwardEligibility (the district's teams, corpus weeks, every award final, weights from slateEntrantWeight) and buildDistrictAwardSlate; build every DCMP tier event's slate with buildDcmpAwardSlate as today; pass awardSlate to eventAwardOutcomeOdds at both tiers.

STEP 6, AFTER. Run `npx tsx scripts/scoreAwardModel.ts --before .planning/quick/261014-qje-one-award-model-for-district-events-and-/261014-qje-before-snapshot.json --write-snapshot .planning/quick/261014-qje-one-award-model-for-district-events-and-/261014-qje-after-snapshot.json --label AFTER`, saving the output as 261014-qje-after-score.txt. Read every GATE line (never the exit code alone). Do not change any slot, class, rule, window, bar or prior after seeing a score. A real bug (code that does not do what this plan states) may be fixed and must be named, with both outputs kept.

STEP 7. Follow the patch_protocol with the name qje-task1.

Return (text, not a file): the verdict line (SCORED: PASS on all seven, or READY FOR DECISION: FAIL on gate N); the seven gate lines; BEFORE and AFTER for the any award lines of both tiers, both class views with each wobble, rookies per season, the Impact Brier, said and real wins, the district eligibility audit, the per slot expected against real winners, the reliability bins and the Brier per season; both district digests; the censuses' headline numbers (cross check mismatches, season list agreement, audience and repeat winners, null weeks, training seasons, new award priors used); the patch path and file list; every named real bug fix.
  </action>
  <verify>
    <automated>npx vitest run packages/core/districts/awardSlate.test.ts packages/core/districts/dcmpAwardSlate.test.ts packages/core/districts/dcmpAwardEligibility.test.ts packages/core/districts/ledgerSimulation.test.ts scripts/measureAwardSlate.test.ts scripts/scoreAwardModel.test.ts (summary lines read; the corpus guarded describe RAN)</automated>
    <automated>npx tsx scripts/scoreAwardModel.ts --before .planning/quick/261014-qje-one-award-model-for-district-events-and-/261014-qje-before-snapshot.json (seven GATE lines read)</automated>
  </verify>
  <done>The BEFORE snapshot reproduces the shipped numbers and digest; every measured literal traces to 261014-qje-measure.txt; the AFTER run printed all seven gate lines; the patch qje-task1.patch exists in SCRATCH, `git apply --check` passes on the restored tree, and `git status --short` shows none of this task's paths. Nothing was committed.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Wire every caller onto the slate, put the Champ Locks cutoff draws on it, and remove the per team model (patch saved, tree restored, READY FOR DECISION)</name>
  <precondition>Runs only after Task 1 returned SCORED: PASS on all seven gates (on any FAIL the orchestrator stops and asks Jacob). SCRATCH/qje-task1.patch exists. `git diff --quiet HEAD --` succeeds for every path in Task 1's file list and this task's file list; otherwise return BLOCKED naming the path. `git apply --check SCRATCH/qje-task1.patch` succeeds, then apply it.</precondition>
  <files>Task 1's files, plus packages/core/districts/awardBaseRates.ts, packages/core/districts/awardBaseRates.test.ts, packages/core/districts/awardOrderingTables.ts, packages/core/districts/awardOrderingTables.test.ts, packages/core/districts/dcmpAwardEligibility.ts, packages/core/districts/dcmpAwardEligibility.test.ts, packages/harness/districtBake.ts, packages/harness/districtBake.test.ts, packages/harness/districtDcmpAwardInputs.ts, packages/harness/districtDcmpAwardInputs.test.ts, apps/web/src/components/districts/dcmpAwardInputs.ts, apps/web/src/components/districts/districtLedgerRows.ts, apps/web/src/components/districts/districtLedgerRows.test.ts, apps/web/src/components/districts/districtRunAssembly.ts, apps/web/src/components/districts/useSimulatedDcmpBake.ts, apps/web/src/components/districts/useDistrictLedgerData.test.ts, apps/web/src/components/districts/useDistrictLedgerData.asOf.test.ts, apps/web/src/components/districts/champLedgerChances.test.ts, apps/web/src/workers/districtAsOfJob.ts, apps/web/src/workers/districtAsOfJob.test.ts, apps/web/src/workers/districtSimulationProtocol.ts, apps/web/src/workers/districtSimulationProtocol.test.ts, apps/web/src/workers/districtWorkerGraph.test.ts, scripts/asOfRewindWeb.test.ts, scripts/publishDistricts.ts, scripts/publishDistricts.test.ts, scripts/measureDistrictAwardBaseRates.ts, scripts/measureDistrictAwardBaseRates.test.ts, scripts/measureAwardOrderingTables.ts, scripts/measureAwardOrderingTables.test.ts, scripts/measureDcmpAwardSlate.ts, scripts/measureDcmpAwardSlate.test.ts, package.json, packages/core/districts/hypotheticalDcmp.ts, packages/core/districts/hypotheticalDcmp.test.ts, packages/core/districts/champCutoffTuning.generated.ts, packages/core/districts/dcmpHistory.generated.ts (only if --check-history shows history drift), apps/web/src/components/districts/champLedgerChances.ts, apps/web/src/components/districts/ChampLocksLedger.tsx (only if it reads the weighting knob), apps/web/src/components/districts/champLedgerRows.test.ts (only if it pins the knob), scripts/measureChampCutoff.ts, scripts/measureChampCutoff.test.ts, scripts/measureLocksInRange.ts (compile only), and in the quick directory 261014-qje-suite-census.txt, 261014-qje-champ-cutoff-before.txt, 261014-qje-champ-cutoff-after.txt</files>
  <read_first>apps/web/src/components/districts/districtRunAssembly.ts (whole), apps/web/src/components/districts/dcmpAwardInputs.ts (whole), apps/web/src/components/districts/champLedgerChances.ts L450 to L510 (buildChampAwardDraws), packages/core/districts/hypotheticalDcmp.ts L495 to L554 (the tuning grid), scripts/measureChampCutoff.ts L1 to L135 and L1000 to L1154, scripts/publishDistricts.ts L1085 to L1250 and L1500 to L1730, packages/harness/districtBake.ts L160 to L400, apps/web/src/workers/districtSimulationProtocol.ts L340 to L390</read_first>
  <behavior>
    - simulateDistrictEvent and eventAwardOutcomeOdds refuse, with a typed MissingAwardSlateError before any draw, any event at either tier whose awards are not posted and that carries no slate; posted awards need none; a district role slate at the dcmp tier, or a DCMP role slate at the district tier, is refused before any draw.
    - Every request the web assemblers build (live, as of real, as of generated, simulated DCMP bake) carries a slate built at the same position; a season with no slate tables carries none, so its events read unavailable (as the DCMP does today).
    - districtRunSignature folds any slate (role, all five counts, sorted eligibility), so a stage change that moves an earlier event's award finality reruns the later event.
    - The protocol accepts a slate with any of the five roles and five finite non negative counts, and rejects a malformed one.
    - A publisher bake of a district candidate carries a district slate whose eligibility uses the publisher's own awards posted rule; a team holding Impact from an earlier final district event has zero mass at 10 in its baked pmf.
    - dcmpAwardEligibility's weights (Q-11): a held candidate weighs its DCMP tier class lift, an open district event's entrant its district tier class lift, a season with no slate tables at that tier the audience weight; an entrant already holding that award at a final district event weighs 0 at the open event; for a season with no slate tables and no such holder, buildChampAwardDraws is deep equal to HEAD's uniform output.
    - With one award to give (count weights all on 1) and every candidate held, the champ draws' per team win frequency over 20,000 runs equals the DCMP slate's per team chance (wholeChampionship role, same position) within 4 standard errors.
    - CHAMP_CUTOFF_TUNING_GRID equals the 10 settings (countMode fixed then drawn, each over the five spread scales ascending) by equality; no setting carries a weighting field.
    - measureChampCutoff --dir reads district artifacts from the given directory; without it the default directory is unchanged.
    - The publisher publishes profiles for 2019 on, priorJudgedAwards from priorDecorationCount, and no award base rate or ordering block.
  </behavior>
  <action>
Implements Q-11, Q-12 and the caller wiring. Nothing commits. This task must not change a single district scored odd; the DCMP lines may move only through the regenerated tuning's countMode (STEP 6).

STEP 0, BASELINES. Before applying anything:
(a) Run `npx vitest run` once over the whole repo from the repo root and save the failing file and test names (if any) to SCRATCH/qje-suite-before.txt.
(b) Add a `--dir <path>` option to scripts/measureChampCutoff.ts (every mode reads district artifacts from it; absent keeps LOCAL_DISTRICT_DIR) with a test, and nothing else.
(c) Compose today's artifacts offline, from the repo root with NO env file: `npx tsx scripts/publishDistricts.ts --years 2016-2020,2022-2026 --dry-run --local-out SCRATCH/qje-local-before`. Never write to data/local-publish. If it reaches for a credential or the network, stop it, record that, and return BLOCKED (the champ cutoff cannot be measured offline). If it runs past the Bash timeout, run it detached with its output to a log in SCRATCH and poll the log.
(d) Run `npx tsx scripts/measureChampCutoff.ts --dir SCRATCH/qje-local-before/<the districts subfolder the dry run wrote, or the folder itself if it is flat>` and save the full output as 261014-qje-champ-cutoff-before.txt in the quick directory; also run `--check-history --dir` with the same folder and record whether HEAD's committed modules reproduce from a fresh compose (drift at HEAD is reported, not fixed).
Then apply qje-task1.patch.

STEP 1, CORE. In ledgerSimulation.ts make awardSlate the one slate field (remove dcmpAwardSlate), required at both tiers when awards are not posted (MissingAwardSlateError replaces the DCMP only refusal; a role and tier mismatch keeps its typed refusal); delete the base rate path, the ordering assignment path, singleAwardPoints' ordering use, awardOrderingAssignments and their types; the disposition union becomes posted, district-slate, dcmp-slate. Rewrite the award describes of ledgerSimulation.test.ts to the slate (model owned assertions only; see STEP 7 for pinned values). Strip awardBaseRates.ts and awardOrderingTables.ts per Q-12 and rewrite their headers to say what they now hold and that the award tables they held were replaced by awardSlate.ts in quick task 261014-qje; strip their tests to the kept exports.

STEP 1b, THE CHAMP DRAWS ON THE SLATE (Q-11). In dcmpAwardEligibility.ts delete dcmpEntrantWeight; give the helper the weight rule of Q-11 (held candidates weigh slateEntrantWeight at the dcmp tier, open district event entrants at the district tier, a season without slate tables at that tier the audience weight through an explicit hasAwardSlateTables check, an entrant already holding that award at a final district event 0 there), keeping its output shape so the DCMP slate and the champ draws read it unchanged; update its header (the weights now come from the one award model) and its test. In hypotheticalDcmp.ts remove ChampCutoffWeighting and the weighting field, build the grid from countMode and spread scale only (10 settings, same order), keep the default as the grid's first entry, update hypotheticalDcmp.test.ts's grid pins by equality. In champLedgerChances.ts make buildChampAwardDraws read the reworked eligibility at the position (through dcmpEligibilityAt, which no longer takes a weighting) and rewrite its doc to say the draws pick winners with the slate's own class weights; update dcmpAwardInputs.ts, the publisher's dcmpBakeAwardSlate and every other caller the typecheck names (ChampLocksLedger.tsx, champLedgerRows.test.ts, measureLocksInRange.ts) to the new signatures, no behavior beyond Q-11. champLedgerChances.test.ts: keep every existing expectation that still holds; replace the decoration weight test with the Q-11 weight tests and the one award agreement test from the behavior block; list every changed expectation old to new. In measureChampCutoff.ts drop the weighting from settingText, the tuning module renderer and anything else that reads it; update measureChampCutoff.test.ts.

STEP 2, SCRIPTS. Move loadAwardInstances, loadRookieYears, priorImpactWinCount (with priorAwardTypeCount if still used) and the district point award census into scripts/measureAwardSlate.ts; delete measureDistrictAwardBaseRates.ts, measureAwardOrderingTables.ts, measureDcmpAwardSlate.ts and their tests; repoint scoreAwardModel.ts. In package.json remove the measure:district-award-base-rates, measure:award-ordering-tables and measure:dcmp-award-slate entries and add "measure:award-slate": "tsx scripts/measureAwardSlate.ts" beside the other measure scripts.

STEP 3, HARNESS. districtBake.ts takes awardSlate (renamed from dcmpAwardSlate) and passes it through. districtDcmpAwardInputs.ts gains the event week lookup the district eligibility needs (from eventPoints and remainingEvents, null kept as null), with a test on a fixture artifact.

STEP 4, WEB. In apps/web/src/components/districts/dcmpAwardInputs.ts add districtAwardSlateAt(artifact, stageByEvent, eventKey): districtAwardEligibility over the artifact's district teams, the week lookup and dcmpAwardFinalAt at the position, weights from slateEntrantWeight with awardProfileOrZero, then buildDistrictAwardSlate over that event's award field. buildDistrictEventSimulationInput's option becomes awardSlate at both tiers. districtRunAssembly.ts: every district tier request (live, as of real, as of generated) carries districtAwardSlateAt at the request's own position and every DCMP tier request keeps dcmpAwardSlateAt; an UnknownAwardSlateSeasonError or UnknownDcmpSlateTargetError leaves the slate off (the event then reads unavailable); the signature folds any slate (rename foldDcmpSlate accordingly and include judgedRookie). useSimulatedDcmpBake.ts only if its call changes. workers/districtAsOfJob.ts carries awardSlate; workers/districtSimulationProtocol.ts validates it (five roles, five counts, the existing eligibility bound). Update useDistrictLedgerData tests, the as of parity tests (useDistrictLedgerData.asOf.test.ts, scripts/asOfRewindWeb.test.ts) and districtWorkerGraph.test.ts only to expect a slate on every request or awardSlate.ts in the worker graph, each change commented with Q-01; never loosen any other assertion. districtLedgerRows.test.ts's fixture disposition becomes district-slate.

STEP 5, PUBLISHER. buildSeasonAwardContext: profiles per the Q-12 season rule, priorJudgedAwards from priorDecorationCount, no award base rate or ordering block (the context type drops both), log lines updated. bakeSeason: a district tier candidate carries a district slate built like dcmpBakeAwardSlate (eligibility from the composed artifact through the harness helpers, awardFinal from the publisher's awards posted rule, weights from slateEntrantWeight); a DCMP candidate as today; the bake skip keys on hasAwardSlateTables for the district tier. publishDistricts.test.ts to the new truth. Run, from the repo root with NO env file, `npx tsx scripts/publishDistricts.ts --years 2020,2023,2026 --dry-run --no-bake`; if it reaches for a credential or the network, stop it, record that, and rely on the tests (never supply credentials; --local-out only ever points into SCRATCH, never at data/local-publish).

STEP 5b, THE CHAMP CUTOFF, AFTER. Compose with this task's code, offline, no env file: `npx tsx scripts/publishDistricts.ts --years 2016-2020,2022-2026 --dry-run --local-out SCRATCH/qje-local-after` (same rules as STEP 0). Then, with `--dir` pointing at the composed district folder: `--write-tuning` (the script writes champCutoffTuning.generated.ts itself, which is its printed output, never edited by hand); `--write-history` ONLY if `--check-history` reports history drift, and then name the cause; `--check-history` must then print no drift for both modules; finally the backtest itself, saving the full output as 261014-qje-champ-cutoff-after.txt in the quick directory. These numbers are reported, not gated: nothing is changed in response to them.

STEP 6, NO DISTRICT ODDS MOVED. Run `npx tsx scripts/scoreAwardModel.ts --before .planning/quick/261014-qje-one-award-model-for-district-events-and-/261014-qje-before-snapshot.json` (no --write-snapshot, so Task 1's AFTER snapshot stays as written) and save the output to SCRATCH/qje-after-complete.txt. The district digest must equal Task 1's AFTER digest; any district difference is a regression from this task: fix it. The DCMP lines may differ from Task 1 only because the regenerated tuning changed a season's countMode (the DCMP slate's qualifying award counts read it): name each season whose countMode changed and confirm every DCMP difference traces to it. The seven pass bar gates are judged on THIS run; if any gate now FAILS, the return says READY FOR DECISION: FAIL on gate N, with both runs.

STEP 7, THE SUITE AND THE OUTSIDE CENSUS. Run `npx vitest run` over the whole repo from the repo root. Every failure in this task's file list is fixed here when it is an award model assertion (slots, counts, chances, refusals, structure). Any failing assertion whose expected value is a pinned number that moved only because district award draws now consume the ledger stream differently or price differently (seeded histograms, totals, digests, Locks cells, cutoff figures), in any file, is an OUTSIDE VALUE: do not edit it; record file, test name, old value, new value, and confirm it passed in qje-suite-before.txt. A failure that is neither, or that also failed in the baseline, or that sits in a file another session holds dirty, is reported with its path and never fixed. Save the census as 261014-qje-suite-census.txt in the quick directory. Then typecheck from the repo root: `npx tsc --noEmit`, `npx tsc --noEmit -p apps/web/tsconfig.json`, `npx tsc --noEmit -p apps/web/tsconfig.e2e.json`, `npx tsc --noEmit -p apps/worker/tsconfig.json`; all four clean (if the web check shows only route tree errors, compare with the same check at HEAD and report). Confirm with git grep that no file this task touched imports locks.js.

STEP 8. Follow the patch_protocol with the name qje-complete (the complete change, Task 1 included).

Return (text, not a file): READY FOR DECISION; the seven gate lines and the digest equality from STEP 6, with any DCMP difference and the countMode change behind it; the CHAMP CUTOFF BEFORE AND AFTER for Jacob, read from the two saved outputs (per district: the simulated line and its p10 to p90 likely range against the published line, and whether the range covered it; the walk forward tuned summary: MAE, bias, and printed range coverage n of N; the untuned default's summary; the setting chosen per season; the gate verdict lines and GO or NO GO; the leak checks), plus whether HEAD's modules reproduced from a fresh compose; the outside census table (file, test, old, new); every test changed to the new truth, one line each; the four typecheck results; the dry run results; the patch path and file list; and the OWED list of Task 3 with values filled in.
  </action>
  <verify>
    <automated>npx vitest run (whole repo from the root; summary lines read; failures only those in the outside census)</automated>
    <automated>npx tsc --noEmit and npx tsc --noEmit -p apps/web/tsconfig.json and npx tsc --noEmit -p apps/web/tsconfig.e2e.json and npx tsc --noEmit -p apps/worker/tsconfig.json</automated>
    <automated>test ! -e scripts/measureDistrictAwardBaseRates.ts and test ! -e scripts/measureAwardOrderingTables.ts and test ! -e scripts/measureDcmpAwardSlate.ts (run before the restore)</automated>
    <automated>test "$(grep -v '^\s*\(\*\|//\)' packages/core/districts/awardBaseRates.ts | grep -c 'export function awardBaseRate(')" -eq 0 (run before the restore)</automated>
    <automated>npx tsx scripts/measureChampCutoff.ts --check-history --dir (the composed AFTER district folder) prints no drift for both modules (run before the restore)</automated>
  </verify>
  <done>Every caller, the Champ Locks cutoff draws included, prices from the slate; the per team model, its three scripts and the champ weighting knob are gone; the district scored odds are bit identical to Task 1's AFTER and any DCMP difference is traced to the regenerated tuning; the champ cutoff BEFORE and AFTER are saved and reported; the outside census lists every moved pinned value with old and new; all four typechecks are clean; qje-complete.patch exists in SCRATCH and applies cleanly to the restored tree; nothing was committed.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Ship prep after Jacob approves: apply, re pin approved values, version stamp, methodology copy, commit</name>
  <precondition>The orchestrator relays Jacob's approval of the scored patch IN A MESSAGE, with the list of outside values he approved for re pinning. Without it, do not start. `git diff --quiet HEAD --` succeeds for every path in qje-complete.patch, packages/harness/pageArtifacts.ts and pageArtifacts.test.ts; otherwise return BLOCKED naming the path. For apps/web/src/components/methodology/districtLedgerContent.ts, awardsContent.ts and their tests run the same check; a dirty copy file is SKIPPED, reported as owed, and the rest proceeds. `git apply --check SCRATCH/qje-complete.patch` succeeds.</precondition>
  <files>every path in qje-complete.patch, the approved outside test files, packages/harness/pageArtifacts.ts, packages/harness/pageArtifacts.test.ts, packages/core/districts/awardSlate.ts, packages/core/districts/awardModelVersion.test.ts, scripts/publishDistricts.ts, scripts/publishDistricts.test.ts, apps/web/src/components/methodology/districtLedgerContent.ts, apps/web/src/components/methodology/districtLedgerContent.test.ts, apps/web/src/components/methodology/awardsContent.ts, apps/web/src/components/methodology/awardsContent.test.ts</files>
  <behavior>
    - A composed district artifact carries awardModelVersion equal to DISTRICT_AWARD_MODEL_VERSION exactly when it carries any awardProfile; DistrictArtifactSchema accepts an artifact without it.
    - awardModelVersion.test.ts: a sha256 over TYPE_SLOT, SEASON_AWARD_TYPES, DISTRICT_POINT_AWARD_VALUES and AWARD_SLATE_TABLES, serialised in a fixed order, equals the digest pinned beside "2.0.0".
    - Content tests: every exported string passes the voice gate (no hyphen, en dash or em dash), structure pinned by equality, every quoted figure equals a value in the saved AFTER score, measure or champ cutoff AFTER output.
  </behavior>
  <action>
Implements Q-13 and the copy. Apply qje-complete.patch.

1. Re pin ONLY the outside values Jacob approved, each to exactly the new value Task 2 reported; if a test now shows a different value, STOP and return BLOCKED with it.
2. Version (Q-13): DISTRICT_AWARD_MODEL_VERSION = "2.0.0" in awardSlate.ts with a doc comment (an artifact without the stamp carries the per team model; bump it with every change to the slot map, a season list or a table, and re pin the digest with it). Optional top level awardModelVersion (z.string().min(1)) on DistrictArtifactSchema; rewrite the priorJudgedAwards and priorImpactWins docs in pageArtifacts.ts to the Q-09 definition (wire names unchanged); the publisher writes the stamp whenever it writes a profile; tests. Create awardModelVersion.test.ts, pinning the digest from its own first printed value, with a comment that a table change must bump the version and re pin both together.
3. Methodology copy, only in files that passed the precondition. Voice: flat third person, very plain short sentences, zero hyphen or dash characters. Every figure from 261014-qje-after-score.txt or 261014-qje-measure.txt, none from this plan. Keep every section id (anchors stay stable).
   - districtLedgerContent.ts: the Awards row of the categories table says the points come from the team awards a team wins at the event (Impact 10, Engineering Inspiration and Rookie All Star 8, other team awards 5); the Awards row of "What decides each open category" says each event has an expected number of each award, shared among the teams that can win it by how teams like it have won before, at district events and District Championships alike; the award base rates section (keep its id) explains the slate in plain words: who can win at each tier (including no repeat of Impact, Engineering Inspiration or Rookie All Star after an earlier district event win), that the award list follows FIRST's list for the season, that a team keeps only its single highest award, and what a team with no published profile is priced as; drop or correct the limits rows that describe base rate tables, judged awards only, or the district table at the District Championship; where the page describes the Champ Locks line's award draws, say the draws pick award winners the same way the award cells are priced; restate the Champ Locks cutoff figures (the simulated line against the published line, and the range coverage) from 261014-qje-champ-cutoff-after.txt. Update the file header's list of measurement commands to pnpm measure:award-slate.
   - awardsContent.ts district section (~L195 to L225) and header comment: replace the base rate and ordering description and table with the slate (the five award slots, what counts toward a team's award record and that Dean's List, Woodie Flowers, Volunteer of the Year, Wildcard and Impact Finalist do not, the 2026 counts per slot and a short table of the 2026 class weights from the measure output, the seasons the model covers, 2023 to 2026); keep the DCMP paragraph consistent with the shared model. Leave the study sections (the goal, the model, our results) untouched.
   - Update both content tests.
4. Verify from the repo root: the task's own test files, then `npx vitest run` over the whole repo (summary lines read; a corpus guarded file that times out under load is rerun alone; a failure in a file another session holds dirty is reported, never fixed), then the four typechecks of Task 2. Confirm nothing imports locks.js from any new or changed award module.
5. Commit by explicit path only (check `git diff --cached --name-only` before each commit): first `feat(quick-261014-qje): one award slate prices district events and DCMPs (Q-01 to Q-13)` with the code, tests, approved re pins and the quick directory's saved outputs; then `docs(quick-261014-qje): methodology copy for the one award model, figures from the AFTER run` for the copy files.
6. Return the SUMMARY text (do not write SUMMARY.md): commits; the pass bar table BEFORE and AFTER; every re pinned value old to new; skipped copy files; and the OWED block below, verbatim with values filled in.

OWED to the main context, in this order (executors have no network and run none of these; each needs Jacob's go ahead):
   a. Worker deploy: pageArtifacts.ts gained awardModelVersion (the Worker's write side parse would strip it); awardBaseRates.ts and awardOrderingTables.ts lost dead tables; hypotheticalDcmp.ts lost the weighting knob and champCutoffTuning.generated.ts was regenerated (all in the Worker import graph). From apps/worker, `npx wrangler deploy` on a clean tree at the final SHA (a dirty tree: a clean detached worktree at that SHA). No Worker behavior changes: the Worker prices no award.
   b. `pnpm publish:districts` (2016 to 2020 and 2022 to 2026): every artifact gets the new priorJudgedAwards and the 2.0.0 stamp, and loses the two award blocks. Offseason, no district is live; the live districts guard still applies.
   c. Check origin/main..main for other sessions' commits, then push main right after (b) so Pages ships the slate. Verify the deploy with an Origin header or a real browser, never a bare curl; run `gh run list` for CI. Between (b) and the Pages deploy the site pairs the old bundle with the new counts; offseason that touches only rewound views for those minutes.
   d. No R2 prune: district keys are unversioned and overwritten in place.
   e. Verify: a published 2026 district file carries awardModelVersion 2.0.0, profiles with the new counts and no award blocks; open a rewound 2026 District Locks view and a 2026 Champ Locks view in a browser; rerun the live e2e specs (the methodology copy changed); the standing check becomes `pnpm score:award-model -- --expect-district-digest <AFTER digest>`.
   f. After (b), run `npx tsx scripts/measureChampCutoff.ts --check-history` against the refreshed data/local-publish/districts (main context, once the republish has also refreshed the local copy, or with --dir on a fresh dry run compose); it must print no drift.
   g. Follow ups: declare the 2027 season award list from FIRST's published list and re measure the slate before the first 2027 event (Q-03, Q-07), then rerun measureChampCutoff --write-tuning; the District Locks cutoff figures in districtLedgerContent.ts (measureDistrictCutoff, measureLocksInRange) were measured under the per team award model and may move once those backtests run on republished artifacts.
  </action>
  <verify>
    <automated>npx vitest run packages/core/districts/awardModelVersion.test.ts packages/harness/pageArtifacts.test.ts scripts/publishDistricts.test.ts apps/web/src/components/methodology/districtLedgerContent.test.ts apps/web/src/components/methodology/awardsContent.test.ts</automated>
    <automated>npx vitest run (whole repo from the root, summary lines read)</automated>
    <automated>npx tsc --noEmit and npx tsc --noEmit -p apps/web/tsconfig.json and npx tsc --noEmit -p apps/web/tsconfig.e2e.json and npx tsc --noEmit -p apps/worker/tsconfig.json</automated>
  </verify>
  <done>The approved patch, the approved re pins, the 2.0.0 stamp with its digest test and the methodology copy are committed by explicit path; the full suite and four typechecks are clean; the SUMMARY text and the filled OWED block are returned.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| corpus to committed literals | measured counts and lifts become shipped table literals |
| pre registration to scoring | the model and the bar must not move after a score is seen |
| bundled tables (web) to published counts (R2 artifact) | the browser pairs the slate tables with published profile counts |
| shared checkout | other Claude sessions edit files concurrently |
| local credentials | .env holds live TBA and R2 secrets |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-qje-01 | Tampering | AWARD_SLATE_TABLES and SEASON_AWARD_TYPES literals | high | mitigate | written programmatically between generated markers from 261014-qje-measure.txt; corpus guarded test re measures every count and lift within 1e-9 and every n exactly, and checks each season list against the census |
| T-qje-02 | Tampering | the acceptance | high | mitigate | Q-01 to Q-10 and the pass bar fixed before scoring; no slot, class, rule, window, bar or prior changes after a score; on a fail nothing is retried and Jacob decides |
| T-qje-03 | Tampering | concurrent sessions | medium | mitigate | clean file preconditions, patch and restore instead of leaving the tree dirty, no git stash, explicit path staging in Task 3 only, `git diff --cached --name-only` before each commit |
| T-qje-04 | Repudiation | published district artifacts | medium | mitigate | awardModelVersion 2.0.0 plus a digest test that fails when a table changes without a version bump |
| T-qje-05 | Tampering | bundle to artifact pairing during release | low | accept | release order Worker, republish, push keeps the mismatch to the Pages deploy minutes; offseason, only rewound views are priced |
| T-qje-06 | Information disclosure | .env | high | mitigate | no task reads, prints or interpolates .env; the publisher dry run runs with no env file; no network command in any task |
| T-qje-07 | Elevation of privilege | locks.ts verdicts | high | mitigate | source test that awardSlate.ts imports nothing ending in locks.js; Task 2 and 3 confirm no touched file imports locks.js; the champ draws feed the Champ Locks chance only, never a verdict |
| T-qje-08 | Tampering | data/local-publish/districts, read by other sessions | medium | mitigate | the publisher dry run writes only into SCRATCH through --local-out; measureChampCutoff reads it through --dir; nothing writes data/local-publish |
| T-qje-09 | Tampering | champCutoffTuning.generated.ts | medium | mitigate | written only by measureChampCutoff --write-tuning from a fresh compose; --check-history must print no drift; the champ cutoff numbers are reported and nothing is tuned to them beyond the existing walk forward selection |
</threat_model>

<verification>
- Task 1: the BEFORE snapshot reproduces the shipped numbers and digest 494ac134...; the measurement's corpus guarded describe runs and passes; the AFTER run prints all seven pass bar gate lines; qje-task1.patch applies cleanly to the restored tree.
- Task 2: the district scored odds are bit identical to Task 1's AFTER (digest), any DCMP difference traces to the regenerated tuning, and the seven gates are judged on the complete change; the champ cutoff BEFORE and AFTER are saved and reported, and --check-history prints no drift on the AFTER compose; the outside census is complete; the four typechecks are clean; qje-complete.patch applies cleanly to the restored tree.
- Task 3: only approved values re pinned; the stamp and digest test land; full suite and four typechecks clean; commits by explicit path.
</verification>

<success_criteria>
- One award slate model, one measurement script and one scorer price district events and DCMPs, and the Champ Locks cutoff draws pick award winners from the same model; the per team model and the separate champ weighting are gone.
- The award list, rookie only awards, stacks, individual awards and the "no award" double count are all handled by construction, and a team never wins Impact, Engineering Inspiration or Rookie All Star twice at district events in one season.
- The pre registered pass bar was evaluated and Jacob saw the result before anything was committed.
- The published artifact names the award model, the methodology pages describe it with AFTER figures, and the main context holds an exact owed list.
</success_criteria>

<output>
Each executor returns its SUMMARY text; the orchestrator writes `.planning/quick/261014-qje-one-award-model-for-district-events-and-/261014-qje-SUMMARY.md`.
</output>
