---
status: resolved
trigger: "A played event's published event presim sidecar fills its RP pmfs from season-final state"
created: 2026-09-28
updated: 2026-09-28
---

# Debug: a played event's published presim sidecar reads season-final ranking point state

## Symptoms

<!-- DATA_START -->
- **Found as:** finding F3 of the resolved debug session .planning/debug/resolved/presim-bake-rp-filler-refuses.md (Evidence entry "Decision 1 Part 1, new finding F3").
- **Expected (walk-forward, predict before update):** every number in a published EVENT presim sidecar, the one the Simulation tab and rewinds into played matches read, is computed only from what was known before that event's first match. That covers its SPR pricing, its ranking point pmfs (`redRpPmf`/`blueRpPmf`), and the gate that decides whether a sidecar exists at all.
- **Actual, per the debugger:**
  - For an event whose schedule has landed and that has been played, `packages/harness/publish.ts` `buildPreScheduleSidecarForEvent` prices SPR from the walk-forward PRE-EVENT state.
  - But its `fillRankingPoints` filler is built from `layerForAlgo` AFTER the whole season's fold: the season-final Sigma map, season-final RP accumulator and season-final mean shift. Those include the event's own matches.
  - The Sigma membership gate also reads season-final Sigma. That is why played events' sidecars always exist.
- **Impact:** a published walk-forward leak on the live site. It predates this session. A rewound rank simulation for a played event can see that event's own results through its RP pmfs.
- **Not yet measured:** how large the leak is in published numbers, and which pages and panels read these pmfs.
<!-- DATA_END -->

## Notes carried over (not in scope unless the fix touches them)

- **F1:** as-of district runs read season-final rosters (event_teams) and schedule lengths. At as-of 04-04, 10 of 14 bakes are DCMP divisions whose rosters depend on later results. Production is unaffected.
- **F2:** `divisioned-dcmp-parent` excludes every event_type 2 event, including 7 single-venue DCMPs with full qualification schedules (nccmp, sccmp, incmp, wicmp, mrcmp, pncmp, cancmp). So the district bake never prices an undivided DCMP.
- **Related open work:** `sigmaCarry` (packages/harness/sigmaCarry.ts) is OFF and must stay off. The todo .planning/todos/pending/early-season-rp-bonus-cold-start.md covers the bonus model.

## Constraints

- Walk-forward is non-negotiable.
- A fix that changes published numbers needs a NEW algorithm version (Jacob: never overwrite in place). Stop and ask before any version bump, republish, D1 seed, deploy or push. Local dry runs are fine.
- Never Read or print .env. Stage by explicit path, since other sessions share this checkout.
- Three unpushed local commits from the previous session are on main (47eceffa, 14088080, f3e5fa10) plus a docs commit (57c15d9e). Jacob said HOLD. Do not push.
- Run vitest from the repo root and verify by the output. Run the root, apps/web and apps/worker typechecks.

## Current Focus

- bug_class: Bohrbug (deterministic publisher output; same inputs, same leak every run)
- status: RESOLVED ON THE BRANCH (code). Branch debug/f3-presim-preevent-proto, head 7c2c099b, based on origin/main bfcb32c8: 3053a5ab F3, 38387a9e F3b proto, a9caad64 F3b option (ii), 30128c60 SPR 8.0.0, 7c2c099b docs. Not pushed, not deployed, not published, not seeded, not pruned; main's ref untouched at 57c15d9e. The rollout is Jacob's (see Resolution.rollout).
- (history) cycle 1 status: ROOT CAUSE CONFIRMED (H1, plus sibling F3b). Fix PROTOTYPED on the branch (43e4ab74 F3, 35424013 F3b, rebased in cycle 2 to 3053a5ab and 38387a9e).
- hypothesis H1 (confirmed): the event presim sidecar's RP filler is built from the season-final SigmaScoutLayer (publish.ts:2119 `sigmaByTeamForAlgo = layerForAlgo.sigmaScoreByTeam()`, 2328-2334 `makeRankingPointFiller(layerForAlgo.rpAccumulator, ..., sigmaByTeamForAlgo, ..., RpMeanShiftAccumulator.fromState(..., layerForAlgo.rpMeanShiftState()))`), for every event, while SPR pricing switches to the pre-event state at 1263-1279. So for pricedFrom "pre-event-walk-forward" the RP moments, Sigma variances, mean shift and the membership gate (474) all include the event's own (and every later) match.
- sibling F3b (confirmed): publish.ts 1280-1287 sends an event with no qualification rows to current-state even when it has been played, so 5 finals-only events price SPR and RP from the season-final state.
- reasoning_checkpoint:
  hypothesis: "Played events' presim sidecars see their own results because the RP filler reads the SigmaScoutLayer after the whole season's fold (and, for 5 finals-only events, the SPR state is season-final too), while the sidecar claims pre-event pricing."
  confirming_evidence:
    - "code: the fold loop (1959-1990) folds every record before any sidecar is built, and the filler is built from `layerForAlgo` for every event regardless of pricedFrom"
    - "metamorphic test: rewriting ONLY the later event's own scores and breakdowns changes its pre-event sidecar at HEAD (both qm and finals-only cases); with the fix the sidecar is byte-identical"
    - "real publisher dry run: freezing the layer at the pre-event instant changes exactly the 209 pre-event sidecars (41 changed, 168 vanished) and nothing else among 36,392 page bodies"
  falsification_test: "A pre-event sidecar that changes when only its own event's results change, after the fix; or any page body or current-state sidecar that differs between the leaked and fixed runs. Neither observed."
  fix_rationale: "Take all three filler inputs (Sigma Scores, RP beliefs, mean shift) from the same instant the SPR pricing state comes from, by freezing them before the event's first folded record, and choose the filler inside buildPreScheduleSidecarForEvent together with the state so the two can never diverge again. F3b: an event that has been played is always priced from its pre-event instant. This removes the cause; it does not relax the all-or-nothing roster rule, whose disappearing sidecars are the honest refusals."
  blind_spots: "Live R2 bodies were not fetched (no network): the 214 count matches the 2026-09-23 publish record, not a byte comparison. The fixed pmfs inherit the known early-season RP cold-start bias (todo early-season-rp-bonus-cold-start); the fix makes them honest, not calibrated. Only 2026 is a presim season, so other seasons were not exercised."
  candidate_causes:
    - "code: filler built from season-final layer state (confirmed)"
    - "code: pricedFrom rule keyed on 'schedule landed' rather than 'event started' (confirmed, F3b)"
    - "data: corpus rows for played events carry no timestamp problem here; the replay itself is chronological (ruled out as a contributor: SPR pre-event states are correct)"
  and_gate: "no for F3 (the season-final filler alone produces it); F3b needs both the qualMatchCount==0 branch AND a played event."
- decision (Jacob, 2026-09-28): rollout A = ship now as SPR 8.0.0 (guarded level1-digest algorithmVersion string approved, digest value must not change); F3b option (ii) = a played event with no qualification rows gets NO presim sidecar (replaces 35424013's pre-event pricing).
- cycle 2 progress: branch rebased onto origin/main (3053a5ab F3, 38387a9e F3b-proto; tree 04169b7b as predicted; main ref untouched at 57c15d9e).
- next_action: main session: push 7c2c099b to origin/main as a fast-forward (held commits stay local), rebase local main onto it, rerun the suite on main (LF), then the rollout in Resolution.rollout with Jacob's grants.

## Evidence

- timestamp: 2026-09-28 (cycle 1, F3 confirmed in code)
  checked: packages/harness/publish.ts `publishSeasonsWith` fold loop (1959-1990), per-algorithm block (2116-2123), sidecar call (2310-2336), `buildPreScheduleSidecarForEvent` (1248-1317), `makeRankingPointFiller` (463-500); packages/harness/sigmaScoutLayer.ts; packages/core/rankingPoints/empiricalMoments.ts
  found: |
    The layer folds EVERY record of the season (1959-1990) before the per-algorithm block runs. `sigmaByTeamForAlgo` (2119) and `layerForAlgo.rpAccumulator` / `rpMeanShiftState()` (2329-2333) are therefore season-final, and one filler per event is built from them regardless of pricedFrom. `buildPreScheduleSidecarForEvent` picks the SPR state (pre-event when qualMatchCount > 0 and a pre-event state was captured; season-final otherwise) but applies whatever filler it is given. The membership gate (`makeRankingPointFiller` 474, all-or-nothing on `sigmaByTeam.has`) reads the same season-final map.
    What the filler reads: `momentsFor(roster)` reads only the roster teams' per-team beliefs (no league-level state); `rosterIsFullyWarm` reads `hasHistory` per team; `allianceSigmaBandVariance` reads only the alliance's Sigma values; the mean shift is its own state. So a pre-event snapshot needs only (Sigma for roster teams with a stored belief, RP beliefs for roster teams, mean-shift state), all at the instant before the event's first folded record.
    Instant alignment: `WalkForwardSimulator.runAll` pushes records match by match in stream order, algorithm inside match (replay.ts ~223-253), and `onMatchComplete` captures the SPR pre-event state at the event's first completed match in that same order. The layer state just before folding the event's first record for that algorithm is the same instant.
  implication: F3 confirmed. A snapshot taken inside the fold loop before `foldPlayed` of each event's first record aligns the filler with SPR's pre-event state exactly.

- timestamp: 2026-09-28 (cycle 1, consumers)
  checked: grep of apps/web/src, apps/worker/src, packages, scripts for presim / preScheduleKey / PublishedPreScheduleArtifactSchema
  found: |
    The pmfs themselves are NOT published: `PublishedPreScheduleArtifactSchema.parse` drops the priced `schedules` block (publish.ts 1316). What ships is `baked.histograms` (per-team rank histograms, 1000 schedules x 50 draws, seeds keyed by eventKey + algorithmVersion only, so common random numbers across a before/after), plus roster, matchesPerTeam, pricedFrom, scheduleCount.
    One reader: the event page Simulation tab. apps/web/src/routes/event.$eventKey.tsx 188-197 fetches `v1/presim/{event}/spr@{version}.json` when the Simulation tab is active; apps/web/src/components/event/SimulationTab.tsx 203-207 makes the baked "Before schedule release" stop the OPENING view whenever a sidecar exists, "live and completed ones included"; 285-287 decodes it (lib/preScheduleResult.ts) into the rank distribution table (buildRankDistributionRows); StartMatchPicker shows the scope line (scheduleCount, draws).
    Not readers: the Worker (no presim reference in apps/worker/src), the district ledger (reads its own v1/district-presim sidecars from scripts/publishDistricts.ts, a separate pricing path in scripts/districtPricingState.ts), and played-match rows (their pmfs come from `foldPlayed`, predict-before-update, not from the sidecar).
    Only SPR publishes ranking points (`publishesRankingPoints`), so only `v1/presim/*/spr@7.0.0+baseline.json` is affected.
  implication: the leak reaches visitors as the default Simulation tab view (rank distributions) on every played 2026 event that has a sidecar. RP-eligible types are 0, 1, 2, 3, 4, 5, 100; the 2026 season is over, so essentially every published 2026 sidecar is priced "pre-event-walk-forward" and leaked.

- timestamp: 2026-09-28 (cycle 1, prototype built, NOT on main)
  checked: prototype in a git worktree outside the repo, branch `debug/f3-presim-preevent-proto` at 57c15d9e, path scratchpad/wt-f3 (node_modules is a junction to the main checkout's; worktree was created with `git -c core.longpaths=true`)
  found: |
    Changes (uncommitted in the worktree): 
    - packages/core/rankingPoints/empiricalMoments.ts: `RpMomentsAccumulator.snapshotFor(teamKeys)` (deep copy of those teams' beliefs), `copyBeliefs` helper shared with `beliefsByTeam` (same output).
    - packages/harness/sigmaScore.ts: `SigmaScoreAccumulator.scoreFor(teamKeys)` (scoreByTeam restricted; absent when no stored belief).
    - packages/harness/sigmaScoutLayer.ts: `sigmaScoresFor(teamKeys)`.
    - packages/harness/publish.ts: `RankingPointFillerInputs`, `snapshotRankingPointFillerInputs(layer, teamKeys)`, `rankingPointFillerFrom(inputs, rule, roster)`; the fold loop freezes each event's inputs (teams in the event's played + scheduled matches) right before its first record folds (presim seasons, RP-publishing algorithms only); `PreScheduleSidecarArgs.fillRankingPoints` became `fillRankingPointsFor(pricedFrom)`, called once after `buildPreScheduleSidecarForEvent` settles pricedFrom: "current-state" gets the season-final layer exactly as before, "pre-event-walk-forward" gets the frozen snapshot (a missing snapshot throws).
    Root tsc on the worktree: clean.
    Instruments (scratchpad): f3-capture.ts (real publishSeasons dry run, spr, seasons 2016-2020 + 2022-2026, includeOffseason, presim from 2026, pinned clock/generation; page digests via artifactSink, sidecar bodies via the Buffer.byteLength hook) run twice: f3-out/full-before from the main checkout (HEAD 57c15d9e, clean packages/scripts/apps), f3-out/full-after from the worktree. f3-pmf-measure.ts (one SPR replay, 2026 layer, leaked vs pre-event filler on the same pre-event SPR state: synthetic schedule pmfs (20 schedules) and the real played quals scored against earned RP) -> f3-out/pmf-2026.json. Detached via scratchpad/start-f3.ps1, logs scratchpad/f3-*.out.log.
  implication: pending run results.

- timestamp: 2026-09-28 (cycle 1, pmf-level size of the leak; f3-out/pmf-2026.json, 268 s)
  checked: f3-pmf-measure.ts over 2026, SPR 7.0.0+baseline, same pre-event SPR state in both arms, leaked (season-final layer) vs fixed (layer frozen before the event's first folded record)
  found: |
    Census: 214 RP-eligible 2026 events with played matches, all rosters in range. 209 are priced "pre-event-walk-forward"; 5 are priced "current-state" although played, because they have NO qualification rows (2026cmptx Einstein, and the finals-only divisioned DCMP parents 2026micmp, necmp, oncmp, txcmp): those price SPR AND RP from season-final state (sibling leak, F3b, untouched by the prototype).
    Coverage manufactured by the leak: of the 209, the leaked filler exists for 209, the pre-event filler for only 41. 168 sidecars exist ONLY because season-final Sigma covers every roster team (week 0-6 regionals and districts, 2026dal and 2026joh with 1 missing team each, 2026week0 with 29 of 29 missing). Missing teams per vanishing event: median 22, 11 events miss exactly 1.
    Size on the 41 events priced both ways (synthetic schedules as the sidecar builds them, 20 schedules, 145,480 rounded alliance pmfs): mean |entry diff| 0.091, max 0.932; mean total variation 0.319, max 0.937; mean |E[RP] diff| 0.50 RP per alliance per match (signed leaked minus fixed +0.50), max 1.69. Bonus odds on the real alliances: mean |diff| 0.168 per bonus, max 0.898, leaked higher by +0.225 bonus RP per alliance.
    Scored on the 41 events' real played quals (7,274 alliance sides, 21,822 bonus observations): total-RP RPS leaked 0.1238 vs pre-event 0.1364; bonus Brier leaked 0.1034 vs pre-event 0.1300. The leak flatters accuracy most at DCMPs and CMP divisions (e.g. 2026micmp3 bonus Brier 0.103 vs 0.211; 2026new 0.110 vs 0.200). At week 3-4 regionals it is often WORSE than pre-event (2026ncpem 0.111 vs 0.065, 2026schar 0.109 vs 0.070): season-final rates reflect end-of-season strength, so they overshoot early events.
  implication: the leak is large at pmf level (half an RP per alliance per match on average), and it also manufactures sidecars: a walk-forward-correct publisher would ship 41 + 5 = 46 of today's 214 2026 sidecars (the 5 F3b events unchanged).

- timestamp: 2026-09-28 (cycle 1, real publisher before/after, scope proof; f3-out/compare-full.json)
  checked: f3-capture.ts full chain 2016-2020 + 2022-2026, spr, before = main checkout at 57c15d9e (git status of packages/scripts/apps clean before and after; 1332 s), after = prototype worktree (709 s); f3-compare.ts
  found: |
    Pages: 36,392 page bodies in both runs, same keys in the same order, 36,392 byte-identical (sha256), 0 differing.
    Sidecars: 214 before (209 pre-event-walk-forward + 5 current-state), 46 after. 5 identical (exactly the 5 current-state F3b events), 41 changed, 168 vanished, 0 appeared. On the 41 changed: roster, matchesPerTeam, pricedFrom, scheduleCount, draws and every stamp identical; only baked.histograms differ. Same census as the pmf instrument (41 + 168 + 5).
    Rank outputs as the Simulation tab renders them (continuousQuantile from apps/web), 1,898 team rows on the 41 changed events: mean |median rank shift| 1.90 places, max 17.5 (2026new frc4590, 41.2 -> 58.7); the rounded median shown changes for 1,506 rows (79%); mean |p10 shift| 1.43 (max 17.7), mean |p90 shift| 1.48 (max 20.9); mean total variation of a team's rank distribution 0.072 (max 0.53); mean |expected rank shift| 1.64 (max 14.6); the median-sorted row order changes on all 41 events.
  implication: the prototype is scope-exact: nothing outside the leaked sidecars moves. The before run reproduces the last full publish's sidecar count (docs/publish-budget.md run line, 2026-09-23: 214 presim sidecars), so these 214 are what the live site serves under spr@7.0.0+baseline (not verified against R2: no network).

- timestamp: 2026-09-28 (cycle 1, regression test, metamorphic oracle)
  checked: new test in the worktree's packages/harness/publish.test.ts, "F3: a played event's sidecar never sees that event's own results — rewriting only them leaves the sidecar byte-identical": two corpora (2024, six teams, parseable 2024 breakdowns, real `spr`), identical except the later event's own scores and breakdowns; asserts the later event's pre-event sidecar body is identical, with a control that the event artifact differs and a vacuity guard that the sidecar exists.
  found: with HEAD's source files checked out in the worktree the test FAILS (histograms differ, e.g. frc1 rank-1 count 23350 vs 21071); with the prototype it PASSES. Worktree suite `npx vitest run packages/harness packages/core/rankingPoints`: 1900 passed, 2 failed, both the known CRLF-only structural tests (rpSeed "publish.ts collects the final season's shift...", sigmaSeed "the one emitSeedSql call site...": "expected to find publish.ts's seedStateRows helper", worktree files are CRLF, main is LF). Worktree typechecks: root, apps/worker, apps/web (routeTree.gen.ts copied in) all clean.
  implication: the test reproduces the leak at unit level and guards against its return. It cannot be committed to main before the fix (it is red there).

- timestamp: 2026-09-28 (cycle 1, sibling F3b and branch state)
  checked: the 5 current-state sidecars of played events; `buildPreScheduleSidecarForEvent`'s qualMatchCount == 0 branch
  found: |
    F3b: 2026cmptx (Einstein, type 4, 24 teams), 2026micmp (13), 2026necmp, 2026oncmp, 2026txcmp (6 each) have played matches but NO qualification rows, so the pricedFrom rule (keyed on "schedule landed", not "event started") sends them to current-state: SPR win odds AND RP pmfs from the season-final state, after the event was played. Each simulates a synthetic 12-match qualification tournament that will never exist.
    Why 2026dal and 2026joh vanish under the fix: one team each debuts at CMP (frc3339 at dal, frc2096 at joh), so no pre-event Sigma.
    Branch debug/f3-presim-preevent-proto (worktree scratchpad/wt-f3, not pushed, not on main): 43e4ab74 = F3 fix + regression test; 35424013 = F3b (a played event with no qualification rows takes the pre-event state and pre-event layer; unplayed events unchanged) + the test parametrized over "qm" and finals-only "f". Verified: at 57c15d9e source both cases FAIL; at 43e4ab74 source F3 passes and F3b fails; at 35424013 both pass. publish.test.ts 226 passed + 1 skipped; root tsc clean.
  implication: F3b is a separable second commit with its own test case. Its dry-run scope check (f3-out/full-after-b vs full-after) is running.

- timestamp: 2026-09-28 (cycle 1, F3b scope and housekeeping)
  checked: f3-out/full-after-b (branch 35424013, 560 s) against full-after (43e4ab74) and full-before; git merge-tree of the branch onto origin/main
  found: |
    F3b vs F3-only: 36,392 pages identical; the 41 F3 sidecars identical; only the 5 F3b sidecars change (pricedFrom current-state -> pre-event-walk-forward, histograms; none vanish). On their 55 team rows: mean |median shift| 1.44, max 8.4 (2026cmptx frc1690, 1.65 -> 10.01).
    Combined vs before: 36,392 pages identical; sidecars 214 -> 46 (46 changed, 168 vanished, 0 appeared); 1,953 team rows: mean |median shift| 1.89, rounded median changes on 79%.
    04169b7b8c1850e53b1e99afca6ac4f253744812: clean (tree 04169b7b), so the fix can ship without the held commits.
    HAZARD: the worktree scratchpad/wt-f3 has three node_modules JUNCTIONS into the main checkout (root, apps/web, apps/worker). Remove it only with scratchpad/cleanup-wt-f3.ps1, which unlinks the junctions first.
  implication: F3b is scope-exact too.

- timestamp: 2026-09-28 (cycle 1, measurement-only sibling F3c)
  checked: scripts/measureFieldAveragedRanks.ts 616-625 and 686-692
  found: the field-averaged experiment replays the target season, folds a SigmaScoutLayer through ALL of it, then prices each target event with the pre-event SPR state and `makeRankingPointFiller(layer.rpAccumulator, ruleModule, layer.sigmaScoreByTeam(), roster)`, the same season-final filler as the publisher (and without the mean shift). Not published output; both arms share the filler, so the arm-vs-arm comparison is fair, but any figure it records against actual outcomes (docs/models/field-averaged-presim.md) is flattered the same way.
  implication: if the fix lands, this script should adopt `snapshotRankingPointFillerInputs`; out of scope for F3.

- timestamp: 2026-09-28 (cycle 2, option ii applied on the branch)
  checked: branch rebased onto origin/main (`git rebase --onto origin/main 57c15d9e`): 3053a5ab (F3), 38387a9e (F3b proto), tree 04169b7b as predicted, main ref untouched, no sigmaCarry or district as-of symbol in the branch. New commit a9caad64: `buildPreScheduleSidecarForEvent` returns no sidecar for a played event with zero qualification rows (logs "played without a qualification schedule, so there is no qualification tournament to forecast"); unplayed no-quals events keep current-state. Tests: F3 metamorphic (qm) kept; F3b now asserts absence for a played finals-only event with a non-vacuity arm (same fixture with quals gets a sidecar); new control: unplayed, registered-roster-only 2024reg gets a current-state sidecar.
  found: |
    Revert check with the new tests: publish.ts at origin/main: F3 FAIL, F3b FAIL, control pass. At 3053a5ab (F3 only, finals-only priced current-state): F3b FAIL. At 38387a9e (proto, finals-only priced pre-event): F3b FAIL ("expected '{"schemaVersion":1,...' to be undefined"). At a9caad64: 3 of 3 pass.
    Dry run at a9caad64 (f3-out/v8-before, 544 s): 36,392 pages, 41 sidecars. vs full-after (F3 only): 36,392 pages byte-identical, 41 sidecars byte-identical, 5 vanished (2026cmptx, micmp, necmp, oncmp, txcmp), 0 appeared. vs full-after-b (proto): same. vs full-before (57c15d9e): pages identical, 214 -> 41 (41 changed, 173 vanished = 168 debut-team + 5 finals-only, 0 appeared).
  implication: option (ii) is scope-exact: no page body moves; only the 5 finals-only sidecars disappear. Next: the SPR 8.0.0 bump.

- timestamp: 2026-09-28 (cycle 2, SPR 8.0.0 bump, commit 30128c60; docs 7c2c099b)
  checked: SPR_VERSION 8.0.0+baseline with a methodology-voice history entry; softCredit.test.ts pin; level1-digest-2026-09.json bpr algorithmVersion string only (Jacob approved). Grep of apps/web, apps/worker, packages, scripts, data/baselines for 7.0.0: remaining hits are synthetic fixtures ("7.0.0", "7.0.0+rolling", "7.0.0-seed-b"), an EPA manifest fixture, history comments, frozen sc3 baselines; docs/publish-budget.md and data/fixtures/phase10/README.md are recorded runs. Prune code is manifest-driven (no hardcoded versions). Dry run at 30128c60 with f3-capture-norm.ts (8.0.0+baseline normalized to 7.0.0+baseline), compared to f3-out/v8-before.
  found: |
    level1Digest.test.ts: passes at 8.0.0 with all three predictionStreamSha256 byte-unchanged (diff of the sha lines vs HEAD: identical); with the digest string left at 7.0.0 it fails ("is now at version 8.0.0+baseline but the committed baseline recorded 7.0.0+baseline").
    Pages: 36,392 in both, 0 key mismatches after normalization, 0 native 7.0.0+baseline in any 8.0.0 body (normalization one-to-one), 1,145,077 replacements. 36,382 identical after normalization (event 2563/2563, team 33799/33799, teams 10/10, events 10/10). Residual: the 10 v1/compare/{year}.json pages, which carry codeVersion "8.0.0" (splitManifestVersion) that the +baseline normalization does not map; text diff of those bodies running (f3-capture-compare.ts, two arms from the worktree, spr.ts at a9caad64 for the 7.0.0 arm).
    Sidecars: 41 before, 41 after, same 41 events, all pre-event-walk-forward, 0 vanished, 0 appeared; nonHistogramFieldDiffs none (roster, matchesPerTeam, pricedFrom, scheduleCount, draws, stamps identical after normalization). Histograms all differ (the bake seeds on eventKey + algorithmVersion): mean |median rank shift| 0.27 places (max 1.91, 2026gal frc364), mean total variation 0.019 (max 0.040), vs the leak's 1.89 places and 0.072: Monte Carlo reseeding noise, not a model change. Bytes 441,831 -> 441,815.
  implication: the bump moves only version strings and seed-dependent histograms, pending the Compare body diff.

- timestamp: 2026-09-28 (cycle 2, Compare residual resolved; suite and typechecks)
  checked: f3-capture-compare.ts in two arms from the worktree with presim off (7.0.0 arm: spr.ts at a9caad64, whose only code difference from HEAD is the SPR_VERSION constant, restored once modules loaded; 8.0.0 arm: HEAD), saving Compare bodies; f3-compare-bodies.cjs leaf diff. Full `npx vitest run` from the worktree root; tsc root, apps/web, apps/web/tsconfig.e2e.json, apps/worker.
  found: |
    Each presim-off arm reproduces every page digest of its full run (36,392 of 36,392, both arms), so the bodies diffed are the full runs' own. 10 Compare files, 2,020 leaves: the ONLY differing leaves are /algorithms/#/version "7.0.0+baseline" -> "8.0.0+baseline" and /algorithms/#/codeVersion "7.0.0" -> "8.0.0", once per file. Page-body totals 1,561,207,211 B in both runs.
    vitest: 298 files (288 passed, 3 failed, 7 skipped), 6,810 tests (6,715 passed, 3 failed, 92 skipped). The 3 failures are CRLF-only: rpSeed and sigmaSeed structural regexes over publish.ts, and measureRpCalibration's doc-drift regex over docs/models/rp-attribution.md (worktree files carry CR bytes: publish.ts 2,807, rp-attribution.md 673). With LF copies of the branch's own two files the 3 files pass (111 tests); CRLF restored, tree clean. All four typechecks exit 0.
    Merge: origin/main is an ancestor of the branch (push is a fast-forward); the 4 held commits replay cleanly onto 7c2c099b one by one (final tree 7bcb38a9 = whole-merge tree). Held publish.ts change is behind options.sigmaCarry === true, which publish:seasons never sets; apps/worker imports sigmaScoutLayer.ts, which 14088080 changes, so the Worker must deploy from a clean tree at the pushed SHA.
    Rollout facts: local corpus last fetched 2026-09-25T15:42Z; 7 offseason events dated 2026-09-25/26 (miwyo, nhgc, isist, njrr, vaale1, wass, flroc) show 0 played matches locally, so the rebaseline's ingest step is needed. D1 algorithm_state PK is (algorithm_id, scope_kind, scope_key); algorithm_version is a label no read filters on; the Worker writes under its compiled-in module version and refuses to fold until seed-cursors.sql matches the new manifest generation.
  implication: every page body differs only in version strings; the fix and bump are verified.

## Eliminated

## Resolution

root_cause: "packages/harness/publish.ts builds every event presim sidecar's ranking-point filler from the season-final SigmaScoutLayer (2119, 2328-2334), because the layer folds the whole season (1959-1990) before any sidecar is built, while the SPR pricing state for a played event is its pre-event state (1263-1279). So a played event's RP pmfs, Sigma variances, mean shift and all-or-nothing membership gate (474) include that event's own matches and every later one. Sibling F3b: an event with no qualification rows (1280-1287) prices from current-state even after it has been played, so 5 finals-only 2026 events take SPR and RP from season-final state."
fix: "Branch debug/f3-presim-preevent-proto (head 7c2c099b, on origin/main bfcb32c8; not yet on main). F3 (3053a5ab): the fold loop freezes the filler inputs (Sigma Scores and RP beliefs for the event's teams, the mean-shift state) right before each event's first folded record; `buildPreScheduleSidecarForEvent` asks for the filler with the pricedFrom it settles on (pre-event snapshot or season-final layer), so pricing state and pmfs always come from one instant. New read-only helpers: RpMomentsAccumulator.snapshotFor, SigmaScoreAccumulator.scoreFor, SigmaScoutLayer.sigmaScoresFor. F3b, Jacob's option (ii) (a9caad64, superseding the 38387a9e prototype that priced them pre-event): a played event with no qualification rows gets NO sidecar; an unplayed no-quals event keeps its current-state forecast. SPR 8.0.0 (30128c60): SPR_VERSION 8.0.0+baseline with a methodology-voice history entry, softCredit pin, level1-digest bpr algorithmVersion string only (digest values unchanged). Docs (7c2c099b): simulation-architecture.md input table."
verification:
  target_test: { result: pass, where: "branch 7c2c099b, packages/harness/publish.test.ts: 'F3: a played event's sidecar never sees that event's own results...' (metamorphic), 'F3b: a played event with no qualification rows ... gets NO sidecar, while the same event with a qualification schedule does', 'F3b control: an UNPLAYED event with no qualification rows ... current state'" }
  mutation_check: { result: pass, reason_if_skipped: "no Stryker configured; manual mutants instead", mutant_killed: "M1 (snapshot one match late): F3 fails (cycle 1). M2 (finals-only priced pre-event, the 38387a9e behavior) and M3 (finals-only priced current-state, the 3053a5ab behavior): the F3b test fails on both" }
  no_op_deletion: { result: flagged, deletion_justified_by_rca: true, note: "173 of 214 2026 sidecars stop being produced: 168 existed only because season-final Sigma satisfied the all-or-nothing roster gate; 5 are played finals-only events with no qualification tournament (Jacob's option ii)" }
  adjacent_tests: { result: pass, note: "full `npx vitest run` from the worktree root: 298 files (288 passed, 3 failed, 7 skipped), 6,810 tests (6,715 passed, 3 failed, 92 skipped). The 3 failures are CRLF-only regexes (rpSeed, sigmaSeed over publish.ts; measureRpCalibration doc drift over docs/models/rp-attribution.md) and pass on LF copies of the branch's own files (3 files, 111 tests). tsc root, apps/web, apps/web/tsconfig.e2e.json, apps/worker: all exit 0. level1Digest.test.ts: all three stream digests reproduce bitwise at 8.0.0; fails if the version string is left at 7.0.0." }
  revert_and_reconfirm: { result: pass, note: "new tests vs publish.ts at origin/main: F3 and F3b fail, control passes; at 3053a5ab and 38387a9e: F3b fails; at a9caad64: all pass" }
  scope: "publisher dry runs 2016-2020 + 2022-2026, spr, pinned clock/generation. a9caad64 vs F3-only run: 36,392 pages byte-identical, 41 sidecars byte-identical, 5 finals-only vanished. 30128c60 (8.0.0) vs a9caad64 (7.0.0): 36,382 pages identical after normalizing 8.0.0+baseline, 10 Compare pages differ only in algorithms[spr].version and .codeVersion (leaf diff of saved bodies, 2,020 leaves); page-body totals 1,561,207,211 B both; sidecars 41 -> 41, same events, all pre-event-walk-forward, no non-histogram field differs; histograms reseeded (seed = eventKey + algorithmVersion): mean |median rank shift| 0.27 (max 1.91) vs the fix's own 1.93 (max 17.56). vs the pre-fix run (57c15d9e): sidecars 214 -> 41 (41 changed, 173 vanished, 0 appeared), sidecar bytes 1,681,462 -> 441,815."
  guardrail_verdict: "accepted on the branch; live rollout pending Jacob's grants"
  rollout: "see the DEBUG COMPLETE return of 2026-09-28: push 7c2c099b to origin/main (fast-forward), rebase local main, deploy the Worker from a clean detached worktree at 7c2c099b, then `pnpm rebaseline --skip-deploy` from main (ingest needed: corpus last fetched 2026-09-25T15:42Z), prune spr@7.0.0+baseline after the 6-hour guard."
files_changed:
  - packages/harness/publish.ts
  - packages/harness/publish.test.ts
  - packages/harness/sigmaScore.ts
  - packages/harness/sigmaScoutLayer.ts
  - packages/core/rankingPoints/empiricalMoments.ts
  - packages/core/algorithms/spr.ts
  - packages/spr/softCredit.test.ts
  - data/baselines/level1-digest-2026-09.json
  - docs/simulation-architecture.md
follow_ups:
  - "Simulation tab copy: the 5 played finals-only events (2026cmptx, micmp, necmp, oncmp, txcmp) now fall to SIMULATION_EMPTY_STATE ('This event doesn't have a qualification schedule yet. Check back once matches are published.'), whose 'yet' and 'check back' are wrong for a finished finals-only event."
  - "F3c: scripts/measureFieldAveragedRanks.ts still prices targets with the season-final filler; adopt snapshotRankingPointFillerInputs (measurement only)."
  - "The 168 debut-team refusals are silent (no presim skip log line); a log line would make the census visible in publish output."
oracle_type: metamorphic (a pre-event forecast must be invariant to the event's own results)
