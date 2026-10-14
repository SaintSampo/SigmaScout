---
phase: quick-261014-mji
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/core/districts/ledgerSimulation.ts
  - packages/core/districts/ledgerSimulation.test.ts
  - scripts/measureSelectionAgreement.ts
  - scripts/measureRandomPickDraft.ts
  - scripts/measureRandomPickDraft.test.ts
autonomous: true
requirements: [261014-mji]

estimate:
  tokens: 110000
  raw_tokens: 220000
  tasks: 3
  confidence: high

must_haves:
  truths:
    - "With the new pick option absent, simulateDistrictEvent is byte for byte the shipped run: every existing test in ledgerSimulation.test.ts, selectionModel.reconciliation.test.ts, districtBake.test.ts and districtSimulationProtocol.test.ts passes with no existing test line edited, and the ledger stream's consumed count per draw is unchanged."
    - "With the option present, each pick turn draws a POSITION in the list of still available teams sorted by published SPR mean, from a first pick pmf or a second pick pmf, truncated to the list and renormalised, consuming exactly one value per pick turn from a separate pick stream seeded by seed XOR PICK_STREAM_SALT. A pmf of [1] for both rounds reproduces the absent run exactly, histograms and ledger counts included."
    - "Nothing in apps/ or packages/harness/ passes the option, so no published number, bake, Worker output or page changes."
    - "The pmf table used to score season Y is built only from real drafts of seasons before Y, and every position is measured against each team's SPR at the end of its own qualification matches at that event (the 10-02 replay path, scripts/publishedSprSnapshots.ts), the same quantity the simulation picks by."
    - "At the quals done position (real final ranking, zero remaining matches) the script scores every team's chance of being on an alliance (captain or pick, backups excluded) for (a) today's fixed SPR draft, (b) the random pick draft, (c) a fixed draft by qualification rank, with Brier, log loss at a stated clip, accuracy and a 12 row calibration table, per season and pooled, and every excluded event named."
    - "The measured numbers, the census and an explicit in-sample list come back as text for the SUMMARY. No methodology copy changes and no version bumps."
  artifacts:
    - path: packages/core/districts/ledgerSimulation.ts
      provides: "optional pickPositionPmf input, PickPositionPmf type, PICK_STREAM_SALT, InvalidPickPositionPmfError, pickDraws on the observation when the option is present"
    - path: packages/core/districts/ledgerSimulation.test.ts
      provides: "an appended describe block: inert at default, degenerate pmf equals absent, position draw, truncation, validation, stream counts"
    - path: scripts/measureSelectionAgreement.ts
      provides: "boundaryRatingsByEvent (total and sigma from the one replay rule) and an injectable boundary map for measurePickOrderHalf"
    - path: scripts/measureRandomPickDraft.ts
      provides: "the walk forward measurement: tables, quals done inputs, three arms, scoring, report, JSON"
    - path: scripts/measureRandomPickDraft.test.ts
      provides: "pure tests for table building, leak boundary, baselines, rank ratings, Brier, log loss, calibration, playoff buckets"
  key_links:
    - from: scripts/measureRandomPickDraft.ts
      to: packages/core/districts/ledgerSimulation.ts
      via: "simulateDistrictEvent(input with or without pickPositionPmf, SIMULATION_DRAWS, DEFAULT_SIMULATION_SEED, observer)"
    - from: scripts/measureRandomPickDraft.ts
      to: scripts/measureSelectionAgreement.ts
      via: "boundaryRatingsByEvent, measurePickOrderHalf(..., boundary) -> TurnResult.modelRank by round"
    - from: scripts/measureSelectionAgreement.ts
      to: scripts/publishedSprSnapshots.ts
      via: "replayPublishedSprSnapshots row.after on qm rows (the boundary rule, unchanged)"
    - from: scripts/measureRandomPickDraft.ts
      to: apps/web/src/components/districts/districtLedgerRows.ts
      via: "playedBracketMatchesFor -> bracketDecisionsFromPlayedMatches -> routePlayedBracket for the real placement"
---

<objective>
Measure, without shipping, whether a random pick draft predicts who ends up on an alliance better than today's fixed draft.

Today the Locks simulation picks greedily by published SPR mean in a fixed order and draws no randomness in the draft. At Quals done the ranking is fixed, so every team's pick chance is 0% or 100%. 2026 UNC Asheville (2026ncash) team 6932 read 0% and was picked (alliance 7, second pick). Jacob decided: MEASURE FIRST, and ship only if the candidate wins.

The candidate draws, at each pick turn, a position k in the list of still available teams sorted by SPR, from a measured pmf of where real picks sat in that list (one pmf for first picks, one for second picks), built walk forward from earlier seasons. It is scored head to head against (a) today's draft and (c) a fixed draft by qualification rank.

Purpose: an honest, walk forward, same code path answer to "is the model overconfident about picks, and does a measured random draft fix it".
Output: an inert optional input in ledgerSimulation.ts, a committed measurement script with pure tests, and the measured numbers returned as text for the SUMMARY. No published number changes.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.claude/CLAUDE.md

Read once, only the named ranges (use Grep to locate if lines have shifted):
- packages/core/districts/ledgerSimulation.ts: 1 to 290 (header, LEDGER_STREAM_SALT), 700 to 840 (DistrictLedgerEventInput), 990 to 1022 (DistrictDrawObservation), 1225 to 1300 (draftedAllianceCount), 1331 to 1425 (validation), 1560 to 1700 (pickOrder, cursors, claim helpers, the two streams), 1778 to 1870 (the draw body and the draft), and the observer literal (grep "observer({").
- packages/core/districts/ledgerSimulation.test.ts: 1 to 198 (imports, fixtures baselinesFor, permutedRatings, profilesFor, inputFor, snapshot), 407 to 456 (the hand computed draft), 720 to 737 (quals done).
- scripts/measureSelectionAgreement.ts: 300 to 520 (committedAtTurn, scoreEventPickOrder, selectDistrictEventKeys, boundaryTotalsByEvent, measurePickOrderHalf) and 860 to 958 (main, entry point guard). Its recorded constants at 120 to 215.
- scripts/publishedSprSnapshots.ts: the PublishedSprSnapshotRow doc (the `after` field).
- packages/core/algorithms/simulation/rankSimulation.ts: drawCategorical and mulberry32 (~60 to 80), SimTeamBaseline (~153), compareByAvgRpDesc (~328).
- packages/core/districts/bracket.ts: BRACKET_SETS (~124), playoffPoints (~321), PlayedBracketMatch (~582), bracketSetIdFor (~604), bracketDecisionsFromPlayedMatches (~652), routePlayedBracket (~707).
- apps/web/src/components/districts/districtLedgerRows.ts: BracketSourceEvent (~903) and playedBracketMatchesFor (~950 to 1035).
- apps/web/src/components/districts/districtLedgerOutcomes.ts: 84 to 160 (the playoff outcome placements and the not picked split).
- apps/web/src/workers/simulationProtocol.ts: SIMULATION_DRAWS and DEFAULT_SIMULATION_SEED.

Facts gathered at planning time (2026-10-14):
- PRE DRAFT SPR COMES FROM THE 10-02 PATH, NOT FROM R2. The methodology table's numbers came from `scripts/measureSelectionAgreement.ts`, whose `boundaryTotalsByEvent` replays the corpus through `replayPublishedSprSnapshots` and keeps, per event, each team's `row.after` total from its qualification rows: its SPR after its last qualification match there, before any playoff match. That is offline and credential free. The origin cache (`data/local-publish/origin-cache`, about 70 MB, present) is NOT needed. There is NO network step in this plan.
- The 10-02 figures (42.91%, 22.34%, 32.62%, 60.51%) were measured on 2026 only with a cold 2026 start (warmup from 2026), to fit a test timeout. The published SPR is replayed from 2016 (`publish:seasons` uses `--seasons 2016-2020,2022-2026 --include-offseason`), so this run replays from 2016 and its 2026 agreement figures will differ slightly. Neither published figure is changed.
- Corpus, eight alliance district events (non-null district_key) per season: 2016 72, 2017 93, 2018 99, 2019 115, 2020 35, 2022 90, 2023 111, 2024 115, 2025 121, 2026 144. Every pre 2023 eight alliance district alliance has exactly 3 picks; a fourth pick (backup) appears only from 2023. The draft itself (captain, first pick round 1 to 8, second pick round 8 to 1) is the same in every season. Backups never enter a pick table. So pre 2023 drafts are usable for tables.
- simulateDistrictEvent refuses seasons before 2023 (`assertBracketSeason`), so only 2023 to 2026 can be SCORED.
- 2026ncash: 30 ranked teams; frc6932 ranked 21; real alliance 7 is [frc2682, frc3680, frc6932].
- SIMULATION_DRAWS = 1000, DEFAULT_SIMULATION_SEED = 20260830. drawCategorical consumes exactly one value and does not renormalise.
- `data/*` is gitignored, so run outputs go under `data/local-publish/pick-draft/`.
- `simulateRanks` sorts by average RP with ties broken by team key, so the measurement builds quals done baselines that reproduce the REAL final rank order exactly (see Task 1).
- At the dcmp tier a run with open awards needs a DCMP award slate. Passing `knownAwardPoints` as an empty map skips awards entirely at both tiers (no profile, no slate, no award randomness), which is right here: awards play no part in who is picked.
- apps/web typecheck has had about 45 routeTree errors until `vite build` runs, so its bar is "no new errors". Record baselines first.
- Other sessions share this checkout. No worktree (the corpus is gitignored and lives only here). Stage by explicit path only; run `git status --short` and `git diff -- <file>` before each commit; stop if a file you need carries someone else's changes.
- Run vitest from the repo root with `npx vitest run <paths>`, never `timeout ... pnpm`. Judge by the printed counts.
</context>

<tasks>

<task type="tracer" tdd="true">
  <name>Task 1: The inert pick option, the shared SPR boundary, and one event end to end (2026ncash)</name>
  <files>packages/core/districts/ledgerSimulation.ts, packages/core/districts/ledgerSimulation.test.ts, scripts/measureSelectionAgreement.ts, scripts/measureRandomPickDraft.ts</files>
  <precondition>data/corpus.sqlite exists in the main checkout (`test -f data/corpus.sqlite`); halt if absent.</precondition>
  <read_first>
    The context block's ranges, each once. Before editing record the typecheck baselines: `npx tsc --noEmit`, `npx tsc --noEmit -p apps/web/tsconfig.json`, `npx tsc --noEmit -p apps/web/tsconfig.e2e.json`, noting each error count. Run `git status --short` and confirm none of this task's files carry uncommitted changes from another session.
  </read_first>
  <behavior>
    Appended as ONE new describe block at the end of ledgerSimulation.test.ts, reusing the file's existing fixtures. No existing line in that file is edited.
    - Inert: the existing suite passes unedited (the proof is running it).
    - Degenerate equals absent: with firstPick [1] and secondPick [1], on inputFor(30) with remaining matches and on inputFor(24, zero remaining matches), at one seed, the whole result deep equals the run without the option (every histogram, selectionRoutes, rankingFixed), and every draw's ledgerDraws matches.
    - The rank stream is untouched: on inputFor(30) with remaining matches, qualPoints histograms are deep equal with and without a non degenerate pmf.
    - Position draw: on the 24 team permuted fixture with zero remaining matches and pmf [0, 1] for both rounds, every pick in every draw is the SECOND best available team by total (a small independent walk in the test is the oracle: progressive captains, serpentine order), except when exactly one team is available, which takes that team.
    - Frequency: firstPick [0.5, 0.5], secondPick [1], 4,000 draws: alliance 1's first pick is the top available team in 50% plus or minus 3% of draws, and the second available team in the rest.
    - Truncation and renormalisation: secondPick [0, 0, 1] takes position 3 when 3 or more teams are available and position 1 when 1 or 2 are (zero mass inside the list falls back to the best available). A pmf whose mass beyond the list is dropped draws the remaining positions in proportion (for example [0.25, 0.25, 0.5] with 2 available draws positions 1 and 2 about evenly).
    - Validation: an empty array, a negative entry, NaN, Infinity, or an all zero array throws InvalidPickPositionPmfError naming every offender (round and position), before any draw (an observer is never called).
    - Stream count: with the option present every observation carries pickDraws equal to 2 x draftedAllianceCount(teamCount, allianceCount); without it the observation has no pickDraws key.
    - Supplied alliances: with knownAlliances supplied, the option changes nothing (deep equal to the same input without it) and pickDraws is 0.
    - PICK_STREAM_SALT is nonzero and differs from LEDGER_STREAM_SALT.
  </behavior>
  <action>
    Per Jacob's MEASURE FIRST decision, and the project rule that a new knob is inert at default and must earn promotion.

    A. packages/core/districts/ledgerSimulation.ts (write the failing tests in B first, then this).
    1. Export interface PickPositionPmf with readonly firstPick and secondPick number arrays. Index i is the weight for position i + 1 in the list of still available roster teams ordered exactly as `pickOrder` is (descending published `total`, ties by ascending team key). Weights need not sum to 1.
    2. Add optional `pickPositionPmf` of that type to DistrictLedgerEventInput, with a doc comment: a measurement candidate from quick task 261014-mji; nothing in the web app, the Worker, the publisher or the bake passes it; absent means today's greedy draft byte for byte; ignored when knownAlliances is supplied, because the draft does not run. It is plain arrays, so it stays structured cloneable.
    3. Export PICK_STREAM_SALT, a nonzero 32 bit constant different from LEDGER_STREAM_SALT, documented beside it: a third independent mulberry32 stream, seed XOR PICK_STREAM_SALT, constructed ONLY when the option is present. State the three reasons it is separate rather than the ledger stream: an absent option constructs and consumes nothing, so every seeded output and pin is unchanged; ledgerDraws keeps meaning bracket plus awards; and with the option present the bracket and award draws reuse the same ledger stream values the fixed draft sees, so a head to head comparison shares random numbers wherever the alliances agree.
    4. Export InvalidPickPositionPmfError (module style: name every offender). Validate in the up front validation, before any draw, only when the option is present: each array non empty, every entry finite and not negative, at least one entry positive.
    5. The draw, in the SIMULATED draft branch only, when the option is present: the round one pick uses firstPick and the round two pick uses secondPick, through one new claim helper beside claimNextByTotal. The helper reads exactly ONE value u from the pick stream on every call (also when one team is left, so the pick stream's count per draw is exactly 2 x draftedCount, pinned). Let m be the number of unallied roster teams (keep a per draw allied counter, reset with `allied`), limit = min(pmf length, m), S = the sum of the first limit weights. If S is positive take the smallest index j whose running sum exceeds u x S (fall back to limit minus 1); if S is zero take j = 0, the best available team. Then claim the (j + 1)th unallied team walking pickOrder from pickCursor, and keep the invariant that every entry before pickCursor is allied. No allocation per turn. So: mass beyond the list is dropped and the rest renormalised, and a position deeper than the pmf's length is never drawn. With the option absent, claimNextByTotal runs exactly as today.
    6. Add optional `pickDraws` to DistrictDrawObservation (values this draw read from the pick stream). Add the key to the observer's object only when the option is present, so the absent observation is unchanged.
    7. Docs: add a header section "THE CANDIDATE RANDOM PICK DRAFT (quick task 261014-mji)" saying what it is, that it is a measurement candidate, inert at default, and that declines stay unmodelled. Qualify the comments that call the draft deterministic (the draw body's step 2, the rankingFixed doc, the selectionRoutes doc) with "when pickPositionPmf is absent". Add no import: the module stays a browser safe leaf.

    B. packages/core/districts/ledgerSimulation.test.ts: append the describe block in behavior. Adding the new names to the existing import statement would edit an existing line, so insert one NEW import statement for them right after the existing import block (the file already has several separate imports from ./ledgerSimulation.js).

    C. scripts/measureSelectionAgreement.ts: add exported boundaryRatingsByEvent(db, seasons, warmupFrom) returning event key to team key to { total, sigma } from the SAME replay call and the SAME rule as boundaryTotalsByEvent (qualification rows only, `row.after`, kept only when total is finite, later rows overwrite earlier). Rewrite boundaryTotalsByEvent as a projection of it so there is one rule. Add an optional fifth parameter to measurePickOrderHalf, a precomputed event to team to total map; when given, the replay is skipped. No recorded constant changes; its corpus describe must still reproduce them.

    D. scripts/measureRandomPickDraft.ts, the spine (Task 2 expands it). Header: purpose, the three arms, walk forward tables, pre draft SPR from the 10-02 path, the quals done position, credential free and offline (no env file flag, no network), usage, and an empty MEASURED block for Task 3. Entry point guard copied from measureSelectionAgreement.ts. Flags: --event KEY, --replay-from (default 2016), --train-from (default 2016), --draws (default SIMULATION_DRAWS), --seed (default DEFAULT_SIMULATION_SEED). For --event: open the corpus read only; seasons = replay-from through the event's season; boundaryRatingsByEvent over them; measurePickOrderHalf over them with the projected totals; pickPositionTables(turns, eventSeason, trainFrom), exported and pure: TurnResults with trainFrom <= season < eventSeason, split by round, raw empirical frequency of modelRank over positions 1 to the deepest observed (no smoothing; positions never seen inside that range are 0). Build the quals done input with exported pure helpers: qualsDoneBaselines (one baseline per ranked team in rank order, earnedRpSum = maxRank minus rank plus 1, matchesPlayed 1, so the order is exactly the real final ranking and no key tiebreak can fire); fieldSize = max(total_teams, ranked count); allianceCount = the real alliance count; tier dcmp for event_type 2 or 5, else district; remainingMatches empty; ratings from the boundary { total, sigma }; awardProfiles empty; knownAwardPoints an empty map. Exclusions, each printed with its reason, and a nonzero exit for --event: not exactly 8 alliances, an alliance team (backup included) with no ranking row (the 10-02 rule), a ranked team with no boundary total or no positive finite sigma. Run (a) without the option and (b) with the tables. A team's on alliance chance is 1 minus notSelectedDraws / draws from selectionRoutes. Assert for (a) that rankingFixed is true and every chance is exactly 0 or 1, else throw a named error. The real outcome is "on an alliance" when the team is in picks 0 to 2 of any alliance (a backup is not). Print the two tables' turn counts, position 1 share and deepest position; one row per team (team, real rank, real outcome, (a), (b)); and the event's Brier for (a) and (b).

    Commit: `feat(quick-261014-mji): an inert random pick draft option and one event measured end to end`, staging the four files by path.
  </action>
  <!-- planner-discipline-allow: pickPositionPmf -->
  <verify>
    <automated>npx vitest run packages/core/districts/ledgerSimulation.test.ts packages/core/districts/selectionModel.reconciliation.test.ts packages/harness/districtBake.test.ts packages/harness/browserSafeSchemas.test.ts apps/web/src/workers/districtSimulationProtocol.test.ts scripts/measureSelectionAgreement.test.ts</automated>
    <automated>git diff -U0 -- packages/core/districts/ledgerSimulation.test.ts | grep -c '^-[^-]' prints 0 (no existing test line removed or changed; run before committing)</automated>
    <automated>grep -rn "pickPositionPmf" apps packages/harness | wc -l prints 0</automated>
    <automated>npx tsx scripts/measureRandomPickDraft.ts --event 2026ncash --replay-from 2025 --train-from 2025 prints a frc6932 row, (a) is exactly 0% or 100% for every team, and both Brier lines print</automated>
    <automated>the three typechecks show no new errors against the recorded baselines</automated>
  </verify>
  <done>The option exists, is validated, draws positions as specified from its own stream, and changes nothing when absent (existing suites green, no existing test line edited). The 10-02 boundary rule now also yields sigma from the same replay. One real event runs end to end through the shipped simulation for (a) and (b). Committed.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: The full walk forward measurement: every scored event, three arms, scores, report</name>
  <files>scripts/measureRandomPickDraft.ts, scripts/measureRandomPickDraft.test.ts</files>
  <read_first>
    Only Task 1's committed script and the bracket and outcome ranges named in the context block. Do not re-read ranges already read in Task 1.
  </read_first>
  <behavior>
    scripts/measureRandomPickDraft.test.ts, pure and corpus free:
    - pickPositionTables: counts by round on hand made TurnResults; each pmf sums to 1 and its length is the deepest position observed; a position never observed inside that range is 0; seasons below trainFrom are left out.
    - The walk forward boundary (leak test): adding TurnResults from season Y and from Y + 1 leaves the season Y tables deep equal.
    - qualsDoneBaselines: run through simulateRanks with zero matches and one draw, the order equals the real rank order, including a pair whose team keys sort the other way.
    - rankOrderRatings: total strictly falls as rank rises, sigma is kept, and a team missing from the rank map throws.
    - realOnAlliance and realSlots: picks 0 to 2 are on an alliance with their alliance and slot; a backup (picks[3]) is not.
    - brierScore, logLoss (clip 0.01 and 0.001), accuracyAtHalf (0.5 counts as on), multiclassBrier, multiclassLogLoss: hand computed values on small cases, including a 0 and a 1 prediction that are wrong.
    - calibrationTable: 12 rows (exactly 0, (0, 0.1), [0.1, 0.2) through [0.9, 1), exactly 1), each with n, mean predicted and observed rate; row counts add to the input size.
    - Playoff buckets: from an elimination point histogram and notSelectedDraws, the five chances (first, second, third or fourth, fifth to eighth, not picked) at district and dcmp tier, point values from playoffPoints, summing to 1.
    - realPlacements: rows generated by routeBracket with a "lower alliance number wins" decider, turned into played rows (sf sets are compLevel sf with their own set number, the final is f set 1), give placements equal to that routing; a bracket missing its final yields no placement map.
  </behavior>
  <action>
    Expand the spine into the full measurement. Every choice below is pre registered; do not tune it after seeing numbers.

    1. Flags: --seasons (scored, default 2023-2026; refuse anything before 2023 with a message, the simulation's own bracket guard), --replay-from 2016, --train-from 2016 (the PRIMARY tables), --sensitivity-train-from 2023, --draws, --seed, --stability, --json PATH, --limit-events N (smoke only), and --event from Task 1. Progress lines go to stderr per season, so a long quiet run is visibly alive.
    2. One replay: seasons replay-from through the last scored season; boundaryRatingsByEvent once; measurePickOrderHalf once over the same seasons with the projected totals. Print the census.
    3. Comparability block: for every season with turns, per round: turns, exact share (position 1), top 3 share, mean, median and p90 position, reusing exactAgreement, top3Agreement and modelRankStats. For each scored season: the primary and the sensitivity table's turn counts and deepest positions, and how many of THAT season's real picks sat deeper than the table's deepest position (picks the random draft could never make). Say in the output that this run warms SPR from 2016 while the published 10-02 figures started cold in 2026.
    4. Population: every eight alliance district event in the scored seasons (selectDistrictEventKeys plus alliances.length equal to SCORED_ALLIANCE_COUNT). Exclusions are counted and every excluded key printed: not eight alliances; an alliance team (backup included) with no ranking row; a ranked team with no boundary total or no positive finite sigma; the simulation threw (print the error name and key; never swallow it silently).
    5. Arms per scored event, all at the quals done input from Task 1 and the same draws and seed: (a) no option. (b) the PRIMARY tables (seasons trainFrom to Y minus 1, so 2023 is scored on 2016 to 2022 drafts). (b2) SENSITIVITY tables from 2023 to Y minus 1, run only for seasons after 2023. (c) a fixed draft by qualification rank: the same simulation with no option and ratings from rankOrderRatings (total = maxRank plus 1 minus rank, sigma kept), so the greedy pick takes the best ranked available team. For (c)'s playoff bucket only, take (c)'s draft from draw 0 through the observer and rerun with those alliances as knownAlliances and the REAL boundary ratings, because (c)'s first run prices the bracket from substituted totals. (a) and (c) must be point masses at quals done; assert it.
    6. Per team predictions: on alliance (selectionRoutes); the exact alliance and slot as 25 classes (alliances 1 to 8 by slots 0 to 2, plus none), tallied from the observer's per draw alliances; the playoff bucket as 5 classes from elimPoints and notSelectedDraws, with point values from playoffPoints, mirroring districtPlayoffOutcomes' not picked split.
    7. Real outcomes: on alliance and the exact slot from the real picks (a backup is none and not on an alliance). The real playoff bucket: build a BracketSourceEvent from the real alliances and the event's corpus sf and f rows (winner red or blue, ties carry no winner), then playedBracketMatchesFor, bracketDecisionsFromPlayedMatches and routePlayedBracket. An event with unresolved rows or fewer than 8 placements is left out of the playoff bucket score only, named.
    8. Scoring, pure and exported: brierScore, logLoss with a clip eps, accuracyAtHalf, calibrationTable, multiclassBrier, multiclassLogLoss. The PRIMARY log loss clip is 0.01, the site's own display bounds (a chance never prints above 99% or below "<1%"); 0.001 is printed beside it.
    9. Report, per arm by scored season and pooled: teams scored, Brier, log loss at 0.01 and 0.001, accuracy, and for the point mass arms "teams called wrong: X of N". The calibration table pooled per arm. Brier per arm by real rank band 1 to 8, 9 to 16, 17 to 24, 25 and below. A named example: 2026ncash frc6932 under every arm, plus every 2026ncash team (a) called wrong. The secondary block: exact slot and playoff bucket multiclass Brier and log loss per arm. VERDICT lines, pre registered: "(b) vs (a): WIN only if pooled Brier AND pooled log loss at 0.01 are both lower", with pooled accuracy and the count of scored seasons where (b)'s Brier is lower printed beside it, and a note that Rule A asks for accuracy too. The same lines for (c) vs (a), and for (b2) vs (a) over (b2)'s seasons. --stability reruns (b) at seed plus 1 and prints the pooled Brier and log loss change. --json writes every table and number.
    10. Write the tests in behavior first, then make them pass.

    Commit: `feat(quick-261014-mji): score the random pick draft against the fixed SPR draft and a rank draft, walk forward`, staging the two files by path after `git status --short` and `git diff -- <file>`.
  </action>
  <verify>
    <automated>npx vitest run scripts/measureRandomPickDraft.test.ts scripts/measureSelectionAgreement.test.ts packages/core/districts/ledgerSimulation.test.ts</automated>
    <automated>npx tsx scripts/measureRandomPickDraft.ts --seasons 2026 --replay-from 2025 --train-from 2025 --sensitivity-train-from 2025 --limit-events 6 prints the arm table for (a), (b) and (c), the calibration tables, the census and the VERDICT lines</automated>
    <automated>the three typechecks show no new errors against Task 1's baselines</automated>
  </verify>
  <done>The script scores every eligible 2023 to 2026 event for all arms with walk forward tables and prints the full report. Pure parts are tested. Committed.</done>
</task>

<task type="auto">
  <name>Task 3: The full run, the record, and the results returned for the SUMMARY</name>
  <files>scripts/measureRandomPickDraft.ts</files>
  <read_first>
    Nothing new. The report the run prints is the input.
  </read_first>
  <action>
    1. `mkdir -p data/local-publish/pick-draft`, then run with the defaults (scored 2023 to 2026, replay and primary tables from 2016, sensitivity from 2023, 1000 draws, seed 20260830): `npx tsx scripts/measureRandomPickDraft.ts --stability --json data/local-publish/pick-draft/261014-mji.json`, with stdout written to `data/local-publish/pick-draft/261014-mji-report.txt`. It is offline. If it might pass the 10 minute foreground limit, run it in the background and poll the report file for the VERDICT lines; stderr progress shows it is alive. Do not narrow the window for the final run.
    2. If an event is excluded for a reason not in Task 2's list, or an assertion fires, stop and report it rather than patching around it.
    3. Fill the script header's MEASURED block (comment only): the exact command, the date, the SPR algorithm id and version the replay used, scored seasons, teams scored per season, and the pooled Brier and log loss (0.01) for (a), (b) and (c), plus each VERDICT line. Recorded, not pinned by any test.
    4. Rerun `npx vitest run scripts/measureRandomPickDraft.test.ts scripts/measureSelectionAgreement.test.ts packages/core/districts/ledgerSimulation.test.ts` and the three typechecks. Confirm `git diff --name-only` holds no file under apps/, apps/worker, packages/harness or the methodology content, and no version string changed.
    5. Commit: `docs(quick-261014-mji): record the measured random pick draft against the fixed SPR draft`, staging the script by path.
    6. Do NOT write the SUMMARY file. Return its full text in the final message: what was measured; the in-sample list below; the census and exclusions; the comparability block; per season and pooled numbers for every arm; the calibration tables; rank bands; the 6932 example; the secondary block; the stability and sensitivity lines; the VERDICT lines; the commit hashes; and the sentence "No published number, methodology page or version changed."

    The in-sample list, stated plainly in the SUMMARY text:
    - SPR's settings were tuned on corpus seasons that include the scored ones. All three arms share this.
    - The captain rule and the serpentine order were measured on 2023 to 2026, the scored seasons included. All arms share this.
    - The candidate's shape (one position pmf per round) was chosen after the published 2026 position figures and the 2026ncash case were seen. The tables themselves are walk forward.
    - The quals done ranking is the real final ranking, not the browser's input, which breaks average RP ties by team key. This isolates the picks.
    - The primary tables pool every earlier season back to 2016. The 2023 onward sensitivity arm shows whether that pooling matters.
  </action>
  <verify>
    <automated>grep -c "VERDICT" data/local-publish/pick-draft/261014-mji-report.txt prints 3 or more</automated>
    <automated>npx vitest run scripts/measureRandomPickDraft.test.ts scripts/measureSelectionAgreement.test.ts packages/core/districts/ledgerSimulation.test.ts</automated>
    <automated>for each of this plan's three commit hashes, git show --name-only --format= HASH lists only files from this plan's files_modified (other sessions may commit in between, so never use a HEAD~N range)</automated>
  </verify>
  <done>The full walk forward run is done, its headline numbers recorded in the script header, and the SUMMARY text (numbers, census, in-sample list, verdicts) returned to the orchestrator. Nothing published changed.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| measurement code to shipped simulation | a new optional input in a module the browser and the publisher both run |
| local corpus to script | read only SQLite, gitignored, no credential |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-mji-01 | Tampering | ledgerSimulation.ts shipped output | high | mitigate | Separate pick stream built only when the option is present; existing seeded pins unedited and green; degenerate pmf deep equals absent; grep shows no caller in apps/ or packages/harness/ |
| T-mji-02 | Repudiation | the measured numbers | medium | mitigate | Pre registered verdict rule and clip; exact command, date and SPR version in the MEASURED block; JSON and report kept under data/local-publish/pick-draft |
| T-mji-03 | Information disclosure | .env | low | accept | The script reads no env file and makes no network request; .env is never read or printed (CLAUDE.md secrets rule) |
| T-mji-04 | Tampering | look ahead leak in tables | high | mitigate | Tables filter season strictly below Y, pinned by a leak test; positions use boundary SPR after the team's last qualification match, before playoffs |
</threat_model>

<verification>
- `npx vitest run packages/core/districts/ledgerSimulation.test.ts packages/core/districts/selectionModel.reconciliation.test.ts packages/harness/districtBake.test.ts packages/harness/browserSafeSchemas.test.ts apps/web/src/workers/districtSimulationProtocol.test.ts scripts/measureSelectionAgreement.test.ts scripts/measureRandomPickDraft.test.ts` all pass, by printed counts.
- Root, apps/web and apps/web/tsconfig.e2e.json typechecks show no new errors.
- No existing line of ledgerSimulation.test.ts was edited; no caller outside scripts/ and the module's own tests names the option.
- The report file holds the VERDICT lines and per season numbers for (a), (b), (b2), (c).
</verification>

<success_criteria>
- The option is inert at default and proven so by unedited pins.
- Tables are walk forward on the 10-02 boundary SPR, with no network step.
- (a), (b) and (c) are scored on one population at quals done with Brier, log loss (clip 0.01, also 0.001), accuracy and calibration, per season and pooled; secondary exact slot and playoff bucket scores are reported.
- The SUMMARY text, including the in-sample list and the verdicts, is returned to the orchestrator. Nothing published changes.
</success_criteria>

<output>
Do not write the SUMMARY file. Return its full text in the final message; the orchestrator writes
`.planning/quick/261014-mji-measure-a-random-pick-draft-against-the-/261014-mji-SUMMARY.md`.
</output>
