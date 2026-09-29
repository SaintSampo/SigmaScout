---
phase: quick-260929-mat
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  # Task 1 (tracer): core, predict emission, capability gate, web gate, version
  - packages/core/rankingPoints/bonusMarginalPmf.ts
  - packages/core/rankingPoints/bonusMarginalPmf.test.ts
  - packages/core/algorithms/epaRankingPoints.ts
  - packages/core/algorithms/epaRankingPoints.test.ts
  - packages/core/algorithms/epa.ts
  - packages/core/algorithms/epa.test.ts
  - packages/core/algorithms/types.ts
  - packages/harness/sigmaScore.ts
  - packages/harness/sigmaScore.test.ts
  - packages/harness/sigmaScoutLayer.ts
  - packages/harness/publish.test.ts
  - data/baselines/level1-digest-2026-09.json
  - apps/web/src/routes/event.$eventKey.tsx
  - apps/web/src/routes/event.$eventKey.test.tsx
  # Task 2: live Worker, D1 state shape, presim, stale pins
  - packages/harness/stateSnapshot.ts
  - packages/harness/stateSnapshot.test.ts
  - packages/harness/publish.ts
  - packages/harness/preSchedule.test.ts
  - packages/harness/sigmaScoutLayer.matchBand.test.ts
  - apps/worker/src/scheduled.ts
  - apps/worker/test/scheduled.rp.test.ts
  - scripts/verifySubsetPublish.ts
  - apps/web/src/components/event/SimulationTab.test.tsx
  - apps/web/src/lib/api/preSchedule.ts
  - apps/web/src/components/districts/useDistrictLedgerData.ts
  - apps/web/e2e/support/simulation.ts
  # Task 3: calibration, docs, methodology copy
  - data/baselines/rp-calibration-2026-09h.json
  - docs/models/epa-statbotics-gap.md
  - docs/models/statbotics-breakdown-reference.md
  - docs/simulation-architecture.md
  - docs/worker-operations.md
  - apps/web/src/components/methodology/epaComparisonContent.ts
  - apps/web/src/components/methodology/epaComparisonContent.test.ts
autonomous: true
requirements: [QUICK-260929-mat]

estimate:
  tokens: 180000
  raw_tokens: 360000
  tasks: 3
  confidence: high

must_haves:
  truths:
    - "Under EPA, every played and upcoming qualification row at an RP eligible event carries redRpPmf, blueRpPmf, redBonusRp, blueBonusRp, matchOutcomePmf, redOutcomeRp, blueOutcomeRp, redBonusRpPmf and blueBonusRpPmf, built only from EPA's own bonus RP slots and EPA's own pRedWin (D-01, D-04)"
    - "EPA's pRedWin, predicted scores, winner, components and team metrics are unchanged from epa@13.0.0: the level 1 digest sha for epa is byte-identical, and a full-corpus Compare capture diff shows zero delta on every opr, epa and spr slice (D-05)"
    - "The event Simulation tab is enabled under SPR and EPA and disabled under OPR; OPR rows carry no RP fields (D-02, D-03)"
    - "The live Worker folds EPA's bonus RP slots on every tick, persists them through D1 (state shape 18), and its published EPA pmf stream equals the offline replay of the same matches (D-06)"
    - "publish:seasons builds EPA pre-schedule sidecars for 2026 RP eligible events from EPA's own predict, never through SPR's filler (D-02, D-04)"
    - "EPA's RP calibration is measured walk-forward (predict before update) over every published season and committed as data/baselines/rp-calibration-2026-09h.json; the SPR records in it equal the SPR records in rp-calibration-2026-09g.json (D-07)"
    - "No doc or page still states that EPA publishes no ranking point odds; L-02 is marked lifted 2026-09-29 with its history kept (D-07)"
  artifacts:
    - path: packages/core/rankingPoints/bonusMarginalPmf.ts
      provides: "bonusMarginalRpPmf: RP total pmf plus decomposition from per bonus marginals and pRedWin, with nested bonuses enumerated by interval"
    - path: packages/core/algorithms/epaRankingPoints.ts
      provides: "unitSigmoid, invUnitSigmoid, EPA RP slot cold value, league bonus rate state, slot update, Prediction RP field mapping"
    - path: packages/core/algorithms/epa.ts
      provides: "version 14.0.0+baseline; predictCore appends RP fields; updateCore folds RP slots; carrySeason resets them"
    - path: packages/harness/sigmaScore.ts
      provides: "publishesRankingPoints (spr, epa) and layerPricesRankingPoints (spr only)"
    - path: packages/harness/stateSnapshot.ts
      provides: "STATE_SNAPSHOT_SHAPE_VERSION 18; epa team rows carry rpSlotOffsets, epa league row carries rpLeague"
    - path: data/baselines/rp-calibration-2026-09h.json
      provides: "spr and epa RP calibration records for every registered RP season"
  key_links:
    - from: "packages/core/algorithms/epa.ts predictCore"
      to: "packages/core/rankingPoints/bonusMarginalPmf.ts bonusMarginalRpPmf"
      via: "RP fields appended after the unchanged score fields"
      pattern: "bonusMarginalRpPmf"
    - from: "packages/harness/sigmaScoutLayer.ts constructor"
      to: "packages/harness/sigmaScore.ts layerPricesRankingPoints"
      via: "RpMomentsAccumulator and mean shift built for spr only"
      pattern: "layerPricesRankingPoints"
    - from: "apps/worker/src/scheduled.ts resumeAlgorithmState"
      to: "packages/harness/sigmaScore.ts layerPricesRankingPoints"
      via: "SPR RP accumulator gate; EPA RP rides EPA state"
      pattern: "layerPricesRankingPoints"
    - from: "apps/web/src/routes/event.$eventKey.tsx"
      to: "packages/harness/sigmaScore.ts publishesRankingPoints"
      via: "isSimulationDisabled"
      pattern: "publishesRankingPoints\\(algorithm\\)"
    - from: "packages/harness/publish.ts presim sidecar gate"
      to: "publishesRankingPoints (eligibility) and layerPricesRankingPoints (filler)"
      via: "fillRankingPointsFor is undefined for epa"
      pattern: "layerPricesRankingPoints"
---

<objective>
Lift L-02 and give EPA its own ranking point odds using Statbotics' method, so the event Simulation
tab (live start-match and pre-schedule) runs under EPA. OPR stays free of RP.

Purpose: Jacob's locked decision of 2026-09-29. The rank simulation should be available on the
community-standard rating, priced the way Statbotics prices bonus RP. It must not borrow anything
from SPR.

Output:
- EPA 14.0.0+baseline, which emits RP pmfs and the decomposition from its own per-team bonus RP
  slots.
- Capability gates split so the SigmaScout layer stays SPR-only.
- State shape 18, so the Worker folds the slots live.
- EPA presim sidecars.
- A web gate that enables Simulation on SPR and EPA.
- A committed calibration baseline, updated docs and methodology copy.
- A main-context ops list.

Decision IDs (from the orchestrator's locked decision block, numbered here for traceability):
- D-01: L-02 lifted. Per-team RP slots, initialized through inv_unit_sigmoid, summed across the
  alliance and passed through unit_sigmoid at prediction time, frozen during elimination matches.
- D-02: the EPA event Simulation tab is enabled, pre-schedule included.
- D-03: OPR stays RP-free and its Simulation stays disabled.
- D-04: EPA RP comes only from EPA's own slots and its own pRedWin. Nothing is taken from SPR's
  Sigma, its RP moments accumulator or its mean shift. This is not an ensemble.
- D-05: EPA winner and score are byte-identical. The slots never feed score or winner. EPA ships as
  a new major version, and only the current version is kept.
- D-06: live Worker parity. EPA slots persist through D1 and fold on every tick.
- D-07: honest publication. Calibration is measured walk-forward and recorded, and docs and copy
  are corrected.

Planner's discretion choices. Each is documented in the gap doc by Task 3.
- P-1: one slot per `rpRuleModuleForSeason(season).bonusNames` entry, keyed by bonus name rather
  than Statbotics' rp_1..rp_3 position. SigmaScout's bonusNames order differs, for example 2017 is
  kPa then rotor. `constant` predicates such as 2019 completeRocket still get a slot, because
  parse() computes their real flag.
- P-2: the observed flag is the rule module's `parse(...).bonusFlags`. This is the exact flag
  `actualBonusFlagsForMatch` publishes as the actual result and the calibration scorer scores
  against. Statbotics reads TBA's recorded `*Achieved` flags instead, and the reconciliation suite
  measures the two as identical outside a few documented tolerances.
- P-3: Statbotics' get_init_epa is kept whole, including its z-score term:
  `cold = preImage(rate) * (1/3 + sdFrac * max(-mean/(3*sd), z_team))`.
  - This reproduces its quirk: when a rate is below about 12%, the pre-image is negative, so a
    stronger team's cold slot goes down. Recorded, not corrected.
  - The rate is walk-forward in the same way as every other week 1 aggregate (the L-01 style):
    frozen week 1 rate once EPA's week 1 seal fires, else the live season rate once
    `EPA_CARRY_RESCALE_MIN_OBS` alliances have folded, else 0.5 (whose pre-image is exactly 0.5).
  - Slots are stored as season-scoped offsets on top of that cold value, so a team's effective
    slot is `cold + offset`. After the seal this is exactly Statbotics' `init + sum of updates`.
- P-4: EPA models no tie, matching Statbotics' binary win_prob. The outcome is
  `[pRedWin, 0, 1 - pRedWin]`, and the bonus RPs are independent of the outcome.
- P-5: bonuses are independent Bernoullis (Statbotics), except `nestedSameVariable` groups
  (2026 energized and supercharged). For those, the marginals are sorted by resolved tier
  threshold, clamped monotone (`q_hard = min(q_hard, q_easy)`) and enumerated by interval, so the
  rule "supercharged implies energized" always holds.
- P-6: attribution follows EPA's existing component convention. The alliance is the
  rating-eligible teams (`ratingEligibleTeams`, surrogates excluded), and the error is split by
  that count. Ruling-zero alliances are skipped per alliance, and a demo match is skipped whole.
- P-7: EPS = 1e-6. The planner fetched it on 2026-09-29 from
  `raw.githubusercontent.com/avgupta456/statbotics/master/backend/src/constants.py`
  (`EPS = 1e-6`, `CURR_YEAR = 2026`). This closes residual gap 5 in reference section 20.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.claude/CLAUDE.md
@docs/models/epa-statbotics-gap.md
@docs/models/statbotics-breakdown-reference.md
@.planning/quick/260913-it4-tear-out-swing-score-and-the-retired-vpr/260913-it4-SUMMARY.md

Source files to read before editing:
- `packages/core/algorithms/epa.ts`, the whole file. Key sites:
  - `predictCore` at about line 496
  - `updateCore` at about 744, with the `sealWeekOneIfPast` call
  - `carrySeason` at about 1045
  - the `version` comment block at about 1126
- `packages/core/rankingPoints/analyticPmf.ts`: `AnalyticRpPmfResult`, `convolvePmf`,
  `groupContribution`'s nested enumeration, and `assertNormalizedPmf`.
- `packages/core/rankingPoints/constants.ts`: `RpRuleModule`, `isRpEligibleEventType`,
  `isBonusRpCompLevel`, `resolveRpThreshold` and `eventTierFor`.
- `packages/core/rankingPoints/2026.ts`, the nested predicate shape.
- `packages/core/algorithms/carryover.ts`, `epaCarryover` at about lines 200-225.
  `carryNormalizedRating(prior.lastSeason.get(t) ?? null, prior.yearBefore.get(t) ?? null)` on
  the returned `priorSeasonRatings` is exactly the carried normalized rating it used.
- `packages/core/algorithms/epaWeekOne.ts`: `isStatboticsWeekOne`, `EPA_WEEK_ONE_MIN_OBS`, and
  the `sealed` flag.
- `packages/harness/sigmaScoutLayer.ts`:
  - the constructor at about line 121
  - `#rpFieldsFor`, whose decomposition mapping must be mirrored field for field
  - `foldPlayed` and `enrichUpcoming`, which pass through an algorithm's own `redRpPmf`
- `packages/harness/sigmaScore.ts` lines 50-70.
- `packages/harness/publish.ts`:
  - `makeRankingPointFiller` at about line 471
  - `attachRpCalibration` at about 1138
  - `buildPreScheduleSidecarForEvent` at about 1369
  - the presim filler snapshot at about 2104-2112
  - the sidecar gate at about 2495-2545
- `packages/harness/stateSnapshot.ts`, lines 100-345: the EPA wire shapes and the shape-version
  history comment.
- `apps/worker/src/scheduled.ts`: `resumeAlgorithmState` at about line 546, and the played-row
  `rpFieldsFor` at about 1518, which already spreads the algorithm's own prediction first.
- `apps/worker/test/scheduled.rp.test.ts`: the "spr: the LIVE pmf stream EQUALS an independent
  offline SigmaScoutLayer replay" test at about line 636 is the template for the EPA parity test.
- `scripts/captureCompareSlices.ts` (usage header) and `scripts/measureRpCalibration.ts` (usage
  header, `--algorithm` accepts a comma list, `--emit-artifact`).

Execution environment rules (from project memory, binding):
- Run in the MAIN checkout, not a worktree. The equivalence capture and the calibration
  measurement read the gitignored `data/corpus.sqlite`.
- Another session shares this checkout (quick 260929-mkn is open).
  - Stage by explicit path only.
  - Never `git add -A` or `git add .`.
  - Do not push.
  - Re-run `git status` after every commit.
- No network. Do not run publish:seasons (real), rebaseline, wrangler, a D1 seed, cleanup, the
  e2e specs, verify:subset or a push. These go into the SUMMARY's owed-ops list.
- Never read, cat or echo `.env`. None of these steps needs it.
- Run vitest from the REPO ROOT with `npx vitest run <paths>` (never `timeout ... pnpm`, which
  swallows output). Judge the result by the printed pass/fail counts, not the exit code.
- Typecheck all three:
  - `npx tsc --noEmit`
  - `npx tsc --noEmit -p apps/web`
  - `npx tsc --noEmit -p apps/worker`

  Root tsc misses apps/web.
- Long offline runs (the capture is about 12 minutes; the calibration may be longer): launch
  detached through `powershell.exe -NoProfile -Command "Start-Process ..."` with stdout and stderr
  redirected to `experiments/260929-mat/*.log` (experiments/ is gitignored), then poll the log.
  Do not use Bash run_in_background, which silently killed a long run at about 6.5 minutes.
- Any new test that regex-reads source text must normalise CRLF first (core.autocrlf is true).
- Copy voice for any user-visible string: flat third person, no hyphen, en dash or em dash
  characters.
- If Write to the SUMMARY is blocked, return the SUMMARY text in the final message. Do not use a
  Bash heredoc.
</context>

<tasks>

<task type="tracer">
  <name>Task 1: EPA RP odds end to end on the offline path (core slots, pmf builder, predict emission, capability split, web gate, 14.0.0)</name>
  <files>packages/core/rankingPoints/bonusMarginalPmf.ts, packages/core/rankingPoints/bonusMarginalPmf.test.ts, packages/core/algorithms/epaRankingPoints.ts, packages/core/algorithms/epaRankingPoints.test.ts, packages/core/algorithms/epa.ts, packages/core/algorithms/epa.test.ts, packages/core/algorithms/types.ts, packages/harness/sigmaScore.ts, packages/harness/sigmaScore.test.ts, packages/harness/sigmaScoutLayer.ts, packages/harness/publish.test.ts, data/baselines/level1-digest-2026-09.json, apps/web/src/routes/event.$eventKey.tsx, apps/web/src/routes/event.$eventKey.test.tsx</files>
  <precondition>data/corpus.sqlite exists in the main checkout (test -f data/corpus.sqlite), and git status shows no staged changes before starting.</precondition>
  <behavior>
    - unitSigmoid(x) equals 1/(1+exp(-4(x-0.5))), with unitSigmoid(0.5) = 0.5 exactly. invUnitSigmoid(unitSigmoid(x)) round-trips within 1e-12.
    - An alliance of three z-neutral teams (sdFrac term zero) with no offsets predicts P(bonus) equal to the league rate within 1e-12.
    - A rate of 0 clamps through EPS=1e-6 and floors the pre-image at -1.
    - A played qm match at an RP-eligible event moves each eligible team's offset for bonus b by exactly percent*(flag - p_alliance)/eligibleCount, where percent = epaPercentFunc(pre-update count) and p comes from the pre-update state.
    - An elimination match, an offseason (99) match, a Week 0 (100) match, a demo match, a ruling-zero alliance and an unparseable or absent breakdown all leave the relevant offsets untouched and never throw.
    - Predict on a qm row at an RP-eligible event emits all nine RP fields.
      - redRpPmf has length maxRp+1 and sums to 1 within 1e-9.
      - matchOutcomePmf = [pRedWin, 0, 1-pRedWin].
      - redOutcomeRp = [winRp, tieRp, 0] and blueOutcomeRp = [0, tieRp, winRp].
      - redBonusRp is positional to bonusNames.
    - Predict on a non-qm row emits only redRpPmf [1] and blueRpPmf [1]. An offseason event, or a season with no rule module, emits no RP key at all.
    - 2026 nesting: the published supercharged marginal never exceeds energized. The bonus pmf never places mass on "supercharged without energized".
    - The score is invariant to RP state. Two states that differ only in rpSlotOffsets and rpLeague give bitwise-identical (Object.is) pRedWin, redScore, blueScore, winner, redComponents and blueComponents. An update from either gives identical teamComponents and teamMatchCounts.
    - carrySeason empties rpSlotOffsets and rpLeague.
  </behavior>
  <action>
Step 0: capture the "before" state FIRST, before editing any source file (D-05).
- Record the base SHA (`git rev-parse HEAD`).
- Run the root vitest once and save the failing-file list to `experiments/260929-mat/vitest-base.txt`, so any failure that already exists stays distinguishable from a new one.
- Launch `npx tsx scripts/captureCompareSlices.ts --out experiments/260929-mat/compare-before.json` detached, as the context section describes.
- Wait until its log shows that the first season has started, then begin editing. tsx has loaded every module by that point.

Step 1: create `packages/core/rankingPoints/bonusMarginalPmf.ts`, a pure module that stays Worker-importable.
- Export `bonusMarginalRpPmf(input)`, where input is `{ redBonusProbabilities, blueBonusProbabilities, pRedWin, ruleModule, eventType, compLevel }`. The two probability arrays are in bonusNames order.
- It returns the existing `AnalyticRpPmfResult` type, reused and imported from analyticPmf.ts. The marginals and marginalResolution fields are omitted.
- If `isBonusRpCompLevel(compLevel)` is false, return `{ redPmf: [1], bluePmf: [1] }`, mirroring analyticRpPmf's short circuit.
- Otherwise, per alliance:
  - Validate that every probability is finite and in [0, 1], and throw otherwise.
  - Group the `nestedSameVariable` predicates by variable.
  - Within each group, sort by `resolveRpThreshold(threshold, eventTierFor(eventType))` ascending. Clamp monotone non-increasing (`q_k = min(q_k, q_{k-1})`) and build the telescoping count pmf `[1-q0, q0-q1, ..., q_last]` (P-5).
  - Every other bonus is `[1-p, p]`.
  - Convolve everything with `convolvePmf` into the bonus-only pmf. Its length must be bonusNames.length+1.
  - The published per-bonus probabilities are the clamped values, in bonusNames order.
- Outcome: `{ pRedWin, pTie: 0, pBlueWin: 1-pRedWin, winRp: ruleModule.winRp, tieRp: ruleModule.tieRp }` (P-4). The outcome pmf has length winRp+1, with the loss probability at index 0 and the win probability at index winRp. Accumulate with `+=`.
- redPmf is convolvePmf(outcome, bonus). Assert that it sums to 1 within 1e-9 and has length maxRp+1, with the same messages style as analyticPmf.
- A nested group spanning two variables, or using direction "lte", throws, as analyticPmf does.
- Export nothing SPR uses. analyticPmf.ts is NOT edited.

Step 2: create `packages/core/algorithms/epaRankingPoints.ts`, pure and Worker-importable. It owns the Statbotics RP math (D-01).
- `unitSigmoid(x) = 1/(1+exp(-4*(x-0.5)))`.
- `invUnitSigmoid(x) = 0.5 + ln(x/(1-x))/4`.
- `EPA_RP_EPS = 1e-6`, with its provenance comment (P-7).
- `EPA_RP_NUM_TEAMS = 3`, Statbotics' num_teams for any season after 2004.
- `EPA_RP_UNINFORMED_RATE = 0.5`.
- `EPA_RP_RATE_MIN_ALLIANCES`, defined as a reference to the existing `EPA_CARRY_RESCALE_MIN_OBS`, not a new number.
- `epaRpPreImage(rate) = max(-1, invUnitSigmoid(max(EPS, min(1-EPS, rate))))`.
- An `EpaRpLeagueState` type: `{ alliances: number; sums: Record<string, number>; weekOneAlliances: number; weekOneSums: Record<string, number>; frozenRates: Record<string, number> | null }`, plus `emptyEpaRpLeague()`.
- `epaRpLeagueRate(league, bonusName)`: `frozenRates?.[name]`, else sums/alliances when `alliances >= EPA_RP_RATE_MIN_ALLIANCES`, else `EPA_RP_UNINFORMED_RATE`.
- `epaRpColdSlot(preImage, sdFrac, zFloor, z)`, which applies P-3's formula. The caller passes `sdFrac = null` when the z term is unreadable, and cold is then preImage/3.
- `epaRpTeamZ(priorSeasonRatings, team)`, computed as `(carryNormalizedRating(lastSeason.get(team) ?? null, yearBefore.get(team) ?? null) - EPA_NORM_MEAN)/EPA_NORM_SD`, importing from carryover.ts.
- Add a test that this equals the normalized value `epaCarryover` itself used for a carried team.
- A `rpPredictionFieldsFrom(result: AnalyticRpPmfResult): Partial<Prediction>` that maps field for field exactly as `SigmaScoutLayer.#rpFieldsFor` does:
  - redRpPmf and blueRpPmf
  - redBonusRp and blueBonusRp, when present
  - the five decomposition fields, only when `outcome` and both bonus pmfs are present
- Keep the fold helpers here as well:
  - league fold, season-wide
  - week-1 fold (only `isStatboticsWeekOne(week)`, and only before the seal)
  - `freezeEpaRpLeague(league)` on the seal transition, which sets `frozenRates` only when `weekOneAlliances >= EPA_WEEK_ONE_MIN_OBS` and otherwise leaves them null so live rates continue
  - the per-team offset update

Step 3: integrate into `packages/core/algorithms/epa.ts` without changing any existing arithmetic (D-05).
- Add `rpSlotOffsets: ReadonlyMap<string, Readonly<Record<string, number>>>` and `rpLeague: EpaRpLeagueState` to `EpaState` with doc comments. initState sets them empty.
- Extract two helpers, each exactly the expression already inline:
  - `seasonScoreSdFor(state)`, the expression predictCore uses for `seasonScoreSd`
  - `seasonMeanAnchorFor(state)`, the numerator carryRescaleRatioFor computes

  Call them from the original sites. The level 1 digest proves this is bitwise.
- In predictCore, after the existing return values are computed and without touching them, append RP fields:
  - Take `season = deriveSeasonFromEventKey(match.eventKey)` and `ruleModule = RP_RULE_MODULES[season]`, the plain lookup. The throwing accessor must not be used.
  - If the ruleModule is undefined or `!isRpEligibleEventType(match.eventType)`, append nothing.
  - Otherwise compute one preImage per bonus from the league rate. sdFrac is sd/mean from the two helpers, or null when mean is not a finite positive number or sd is not positive. zFloor is -mean/(3*sd).
  - For each alliance's eligible teams (the same `redTeams`/`blueTeams` predictCore already derived), sum `cold(team) + (offset ?? 0)` and take unitSigmoid. The sum is the Statbotics pred_mean for the slot, and unitSigmoid is post_process_breakdown.
  - Pass those probabilities and the already-computed pRedWin to `bonusMarginalRpPmf`, and spread `rpPredictionFieldsFrom(result)` into the returned Prediction after the existing keys.
- In updateCore, after the component updates, compute from the PRE-update state and fold:
  - Only when `result.compLevel === "qm"`, `isRpEligibleEventType(result.eventType)`, a rule module exists, and the breakdown is present.
  - Parse both sides with `ruleModule.parse(JSON.parse(raw), side, result.eventType)` inside try/catch. A throw means no RP fold for that side, and it never increments breakdownParseFailureCount.
  - For each non-ruling-zero parsed alliance, with a non-empty eligible roster:
    - `err = Number(bonusFlags[name]) - p`, where p is the alliance probability predict would give from the pre-update state
    - each eligible team's offset += `epaPercentFunc(pre-update matchCount) * err / eligibleCount`
    - quals always have weight 1, and elimination matches never reach this code (D-01 freeze)
  - Then fold the alliance's flags into rpLeague.
  - Detect the week-1 seal transition (`!state.weekOne.sealed` and the new weekOne is sealed). Freeze BEFORE folding this match, matching the existing "seal first, then fold" rule.
  - Return the new maps. The existing returned fields stay byte-identical.
- In carrySeason, reset rpSlotOffsets to an empty Map and rpLeague to `emptyEpaRpLeague()`. Slots are season-scoped because every season's bonuses are different tasks. The z term carries strength through priorSeasonRatings instead.
- Bump `version` to `"14.0.0+baseline"`, and add a 14.0.0 paragraph to the version comment:
  - quick task 260929-mat, 2026-09-29
  - L-02 lifted by Jacob
  - Statbotics RP slots emit RP pmfs
  - predict and update score arithmetic untouched, which is why the level 1 digest sha is unchanged
  - MAJOR because published rows gain RP fields
- Update the file header's divergence list with P-2..P-6 in one line each.

Step 4: tests.
- `bonusMarginalPmf.test.ts` and `epaRankingPoints.test.ts` cover the behavior block.
- In `epa.test.ts`:
  - change the version pin at about line 1683 to 14.0.0
  - add the score-invariance, elimination-freeze and carrySeason-reset cases
- Build real breakdowns with the existing 2026 fixture helpers the RP rule tests use.

Step 5: split the capability in `packages/harness/sigmaScore.ts` (D-03, D-04).
- `RANKING_POINT_SOURCES = { spr: "sigma-layer", epa: "algorithm" }`.
- `publishesRankingPoints(id)`: the id is a key, so spr and epa.
- New `layerPricesRankingPoints(id)`: source is "sigma-layer", so spr only.
- Doc comments name what each gate asks.
- `sigmaScore.test.ts` pins literal ids:
  - publishesRankingPoints: spr true, epa true, opr false
  - layerPricesRankingPoints: spr true, epa false, opr false
- `sigmaScoutLayer.ts` constructor: replace the `publishesRankingPoints(algorithmId)` call with `layerPricesRankingPoints(algorithmId)`. EPA therefore gets no RpMomentsAccumulator and no mean shift, and its own fields pass through foldPlayed and enrichUpcoming untouched (D-04).
- Update the layer's header, which says RP is published for Sigma algorithms only.
- Update the `Prediction.redRpPmf` doc in `packages/core/algorithms/types.ts`: SPR's RP is attached by the layer; EPA's own predict emits it from its bonus RP slots.

Step 6: add an end-to-end tracer test in `packages/harness/publish.test.ts`.
- Replay a small fixture season stream for `epa` through `WalkForwardSimulator` and `SigmaScoutLayer`, using whatever fixture the existing event-artifact tests already use, then call `buildEventArtifact`.
- Assert:
  - every RP-eligible qm row carries redRpPmf, blueRpPmf and matchOutcomePmf
  - every non-qm row carries at most the [1] pmfs
  - the same fixture under `opr` carries none

Step 7: web gate (D-02, D-03).
- In `apps/web/src/routes/event.$eventKey.tsx`, set `isSimulationDisabled = !publishesRankingPoints(algorithm)` (import from the same sigmaScore.js).
- Change the disabled trigger title to "Simulation is available on SPR and EPA. Switch the algorithm selector to SPR or EPA." This has no dash characters.
- Reword the comments at about lines 48 and 181-190 by concept.
- In `event.$eventKey.test.tsx`, at about lines 498-529:
  - the OPR trigger stays disabled with the new title
  - add that the EPA trigger is enabled and `?tab=simulation` resolves to simulation under epa

Step 8: move the `epa` entry's `algorithmVersion` in `data/baselines/level1-digest-2026-09.json` to "14.0.0+baseline".
- Use the Edit tool, since this file is guarded from Bash.
- Leave `predictionStreamSha256` exactly as it is. Unchanged, it is the slice-level proof that predict's score path did not move (D-05). Precedent: commits 3f36e582 and b8eb402e.
- If level1Digest.test.ts then fails on the sha, stop and report. Never re-freeze the sha.

Commit, staged by explicit path: `feat(260929-mat): EPA predicts ranking points by Statbotics' method; Simulation enabled under EPA`.
  </action>
  <verify>
    <automated>npx vitest run packages/core/rankingPoints/bonusMarginalPmf.test.ts packages/core/algorithms/epaRankingPoints.test.ts packages/core/algorithms/epa.test.ts packages/harness/sigmaScore.test.ts packages/harness/level1Digest.test.ts packages/harness/publish.test.ts "apps/web/src/routes/event.\$eventKey.test.tsx"</automated>
  </verify>
  <done>
- All listed test files pass.
- level1Digest.test.ts reproduces the unchanged epa sha b30d7aa5... under version 14.0.0+baseline.
- The tracer test shows EPA qm rows carrying pmfs and the decomposition end to end, and OPR rows carrying none.
- The EPA Simulation trigger is enabled and OPR's is disabled.
- `experiments/260929-mat/compare-before.json` exists, or its detached run is still in progress with a live log.
- Committed.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: live Worker parity, D1 state shape 18, EPA pre-schedule sidecars, stale pins</name>
  <files>packages/harness/stateSnapshot.ts, packages/harness/stateSnapshot.test.ts, packages/harness/publish.ts, packages/harness/preSchedule.test.ts, packages/harness/sigmaScoutLayer.matchBand.test.ts, apps/worker/src/scheduled.ts, apps/worker/test/scheduled.rp.test.ts, scripts/verifySubsetPublish.ts, apps/web/src/components/event/SimulationTab.test.tsx, apps/web/src/lib/api/preSchedule.ts, apps/web/src/components/districts/useDistrictLedgerData.ts, apps/web/e2e/support/simulation.ts</files>
  <behavior>
    - The EPA state round-trips serializeState then deserializeState with rpSlotOffsets and rpLeague deep-equal, including frozenRates null and non-null.
    - A shape-17 league row is refused with LeagueRowShapeVersionError.
    - A team with no offsets serializes with no rpSlotOffsets key.
    - The live Worker EPA pmf stream (redRpPmf, blueRpPmf) over the scheduled.rp fixture digests equal to the offline SigmaScoutLayer replay of the same matches, and is non-vacuous.
    - OPR live and offline rows still carry no RP fields.
    - The presim sidecar for an EPA 2026 RP-eligible event is built from EPA's own predict: fillRankingPointsFor is undefined for epa, and no pre-event SPR filler snapshot is taken for epa.
  </behavior>
  <action>
1. `packages/harness/stateSnapshot.ts` (D-06).
   - The EPA team row gains `rpSlotOffsets?: Record<string, number>`, omitted when absent or empty so unaffected rows stay byte-identical.
   - The EPA league row gains `rpLeague` with the exact EpaRpLeagueState fields. `frozenRates` is null or a record.
   - deserializeEpaState reads both, with empty defaults on a team row with no key.
   - Bump `STATE_SNAPSHOT_SHAPE_VERSION` from 17 to 18, and add a history paragraph in the existing style: "17 -> 18 (EPA 14.0.0): epa team rows gain rpSlotOffsets and the epa league row gains rpLeague ... needs a reseed from a fresh publish".
   - Update every test that pins 17 deliberately.
   - Add the round-trip and refusal tests from the behavior block to stateSnapshot.test.ts.
2. `apps/worker/src/scheduled.ts`.
   - In resumeAlgorithmState (about line 546), replace the `publishesRankingPoints(algorithmId)` gate with `layerPricesRankingPoints(algorithmId)`. SPR keeps its accumulator and mean shift, and EPA gets none (D-04).
   - The played-row spread `{...prediction, ...rpFieldsFor(...)}` and the upcoming `priceUpcomingRows` mirror already keep an algorithm's own pmf. Read both to confirm, and change nothing there.
   - Reword comments that say OPR and EPA publish no RP, keeping the Match Band statements.
   - Read how the tick treats a league row whose shape version mismatches (generation-mismatch refusal versus a throw), and record the exact behavior for the ops list.
3. `apps/worker/test/scheduled.rp.test.ts`.
   - Add an `epa` test modeled on the spr live-equals-offline digest test: non-vacuous on both arms, then `computeRpStreamDigest` equality.
   - Make the opr/epa absence helper and its test opr-only.
   - If "the decomposition fields reach live PLAYED rows" iterates algorithms, add epa.
4. `packages/harness/publish.ts` presim (D-02, D-04).
   - The pre-event filler snapshot map at about line 2111 is built only for `layerPricesRankingPoints(algorithm.id)`.
   - Sidecar eligibility at about 2495 stays `publishesRankingPoints(algorithm.id)`, so epa is now included.
   - Pass `fillRankingPointsFor` only when `layerPricesRankingPoints(algorithm.id)`, and `undefined` otherwise. buildPreScheduleArtifact then prices EPA synthetic matches straight from `algorithm.predict`, which carries EPA's pmfs.
   - Update the comments at about 1339, 2102-2106 and 2490-2494.
   - Update `makeRankingPointFiller`'s doc to say it serves layer-priced (SPR) RP only.
   - Leave `attachRpCalibration`'s gate as `publishesRankingPoints`. Task 3 supplies the epa records it will then attach.
5. `packages/harness/preSchedule.test.ts`.
   - Add a case in which an EPA-shaped predict closure, emitting its own pmfs and decomposition, yields a non-null sidecar, with the decomposition carried in every simInput.
   - If a publish-level presim test exists in publish.test.ts, add an epa arm asserting that a sidecar key `v1/presim/...epa@14.0.0+baseline...` is produced for a 2026 RP-eligible fixture event.
6. Stale pins and comments. Each reworded by concept, with no numbers changed:
   - `packages/harness/sigmaScoutLayer.matchBand.test.ts`: absence becomes OPR only, and EPA RP presence is asserted.
   - `packages/harness/publish.test.ts`: the absence tests at about lines 540-603. Check which algorithm each uses; keep them for opr, switch or duplicate them to assert presence for epa where the fixture is RP-eligible.
   - the RP algorithm list test at about line 5353: add an explicit equality pin `expect(rpAlgorithmIds).toEqual(["epa", "spr"])` in PUBLISHED_ALGORITHM_IDS order.
   - `apps/web/src/components/event/SimulationTab.test.tsx` line 171: the title and comment say ranking point odds are published by SPR and EPA, and the OPR case is unchanged.
   - comments in `apps/web/src/lib/api/preSchedule.ts` line 16 and `apps/web/e2e/support/simulation.ts` line 45.
   - `apps/web/src/components/districts/useDistrictLedgerData.ts` line 44: the district ledger deliberately stays on SPR's pmfs. Only the claim that EPA publishes none is corrected.
7. `scripts/verifySubsetPublish.ts`.
   - For every `algorithmId: "epa"` entry at an RP-eligible event, set `expectPlayedQmRpPmf` to "present", or "partial" where the spr entry for the same event is partial for a cold-start reason that does not apply to EPA. Decide per entry by reading the note, and keep "absent" for offseason entries.
   - Rewrite the notes by concept: publishesRankingPoints() is true for spr and epa.
   - This script hits the live origin, so it is not run here. It is on the owed-ops list.
8. Run the full root suite `npx vitest run` and compare its failing files with `experiments/260929-mat/vitest-base.txt`. Every new failure must be fixed or explained.
9. Run the three typechecks.
10. Commit, staged by explicit path: `feat(260929-mat): EPA ranking points fold live, persist in D1 (state shape 18), and price pre-schedule sidecars`.
  </action>
  <verify>
    <automated>npx vitest run packages/harness/stateSnapshot.test.ts apps/worker/test/scheduled.rp.test.ts packages/harness/preSchedule.test.ts packages/harness/sigmaScoutLayer.matchBand.test.ts packages/harness/publish.test.ts apps/web/src/components/event/SimulationTab.test.tsx && npx vitest run && npx tsc --noEmit && npx tsc --noEmit -p apps/web && npx tsc --noEmit -p apps/worker</automated>
  </verify>
  <done>
- EPA live and offline RP digests are equal.
- Shape 18 round-trips, and shape 17 is refused.
- The EPA presim sidecar is produced without SPR's filler.
- The root vitest shows no failures beyond the recorded base list.
- All three typechecks are clean.
- Committed.
  </done>
</task>

<task type="auto">
  <name>Task 3: calibration baseline, docs and copy, full-corpus equivalence gate, owed-ops list</name>
  <files>data/baselines/rp-calibration-2026-09h.json, packages/harness/publish.ts, docs/models/epa-statbotics-gap.md, docs/models/statbotics-breakdown-reference.md, docs/simulation-architecture.md, docs/worker-operations.md, apps/web/src/components/methodology/epaComparisonContent.ts, apps/web/src/components/methodology/epaComparisonContent.test.ts</files>
  <action>
1. Calibration (D-07).
   - Launch detached: `npx tsx scripts/measureRpCalibration.ts --seasons 2016-2020,2022-2026 --algorithm spr,epa --emit-artifact data/baselines/rp-calibration-2026-09h.json`.
   - The run is walk-forward through SigmaScoutLayer.foldPlayed with predict before update. EPA's own pmfs pass through, so the scorer measures EPA's own odds.
   - When it finishes, check with a node one-off that the `spr` records in 09h deep-equal the `spr` records in 09g. If they differ, stop and report: that means SPR's RP stream moved, which the plan forbids.
   - Point `RP_CALIBRATION_MEASUREMENT_PATH` in publish.ts at the 09h file, so the publish.test.ts set-equality test sees spr and epa for every registered season.
   - If the baseline's single `rpLayer` string describes only SPR's layer, leave it and note that in the SUMMARY.
   - Record in the SUMMARY a table per season plus pooled figures for both algorithms: bonus Brier, mean predicted against observed frequency per bonus, the total-RP ranked probability score, and the outcome Brier. Put EPA beside SPR with no spin.
2. Docs, reworded by concept with history kept.
   - `docs/models/epa-statbotics-gap.md` L-02:
     - keep the verbatim quote and add "LIFTED 2026-09-29 by Jacob" with the locked decision text and quick task id
     - in "How to read a verdict", L-02 is historical
     - Mechanism 4 becomes ADOPTED 2026-09-29, with the per-season verdict and P-1..P-7 as named deliberate differences, plus the residuals: the rp_x_mean write site in avg.py is not transcribed, so SigmaScout uses week 1 qualification alliances at RP-eligible events
     - the 2016/2017 elimination score terms (registers R1/R2) remain NOT adopted, because EPA's score must not change
     - fix the sentence at about line 382 that says EPA publishes no RP number
   - `docs/models/statbotics-breakdown-reference.md`:
     - change only the NOT ADOPTED annotations in sections 12, 13 and 15 to ADOPTED 2026-09-29 (quick 260929-mat), with the transcriptions untouched
     - section 20 row 5 (EPS): CLOSED 2026-09-29, `EPS = 1e-6` and `CURR_YEAR = 2026` per the planner's 2026-09-29 fetch of backend/src/constants.py
   - `docs/simulation-architecture.md`: add a dated 2026-09-29 note below the 2026-09-13 note saying the simulation runs under SPR and EPA, with OPR still RP-free.
   - `docs/worker-operations.md` at about line 438: SPR's ranking point layer is still SPR's alone, but EPA's own RP odds fold live as part of EPA state (shape 18). Name the reseed requirement.
3. Methodology copy, in `apps/web/src/components/methodology/epaComparisonContent.ts`, flat third person with no dash characters.
   - Append to EPA_SAME_PARAGRAPH: "Both sites also predict each bonus ranking point the same way. Every team carries a rating for it, the alliance adds its ratings, a curve turns the sum into a chance, and elimination matches leave those ratings alone."
   - In the week-one-numbers row, change the statbotics cell to "Score spread, foul rate and bonus ranking point rates come from all of week 1 and apply to every match, week 1 included". The sigmascout and note cells stay as they are.
   - Run epaComparisonContent.test.ts and the route test; the voice, fact and liability gates must stay green.
   - Link the file in the SUMMARY so Jacob can edit the copy.
4. The final equivalence gate (D-05).
   - Launch `npx tsx scripts/captureCompareSlices.ts --out experiments/260929-mat/compare-after.json` detached. This is the real publishSeasons dry run, so it also asserts every artifact byte ceiling on the new EPA rows and the Compare artifact with EPA's rpCalibration.
   - Then run `npx tsx scripts/captureCompareSlices.ts --diff experiments/260929-mat/compare-before.json experiments/260929-mat/compare-after.json`.
   - Required: zero delta on every opr, epa and spr slice.
   - If a byte ceiling trips, STOP and report it as a blocker for Jacob. Do not raise any ceiling.
   - Run the full root vitest and the three typechecks one last time.
5. Commit, staged by explicit path: `docs(260929-mat): EPA RP calibration baseline, L-02 lifted, methodology and ops docs`.
6. Write the SUMMARY. It includes:
   - the equivalence table: level 1 digest sha, compare diff result, and the SPR 09g/09h record equality
   - the calibration table
   - the deliberate-differences list P-1..P-7
   - EPA pages now show predicted bonus RP dots
   - an "Owed from main context" list, in this order:
     1. Worker deploy, with Jacob's in-message grant. Use `npx wrangler deploy` from a clean tree or `pnpm rebaseline`. State the recorded shape-mismatch window behavior.
     2. `pnpm rebaseline --skip-ingest`, or `--from publish` after the deploy. This republishes epa@14.0.0 and the 2026 EPA presim sidecars, seeds all four files with cursors last (shape 18), verifies, and prunes.
     3. `pnpm cleanup:r2-generations` or `pnpm rebaseline --from prune` after the six hour window, to prune epa@13.0.0+baseline.
     4. Commit the docs/publish-budget.md the publish rewrote.
     5. `pnpm verify:subset`.
     6. The live e2e simulation family, and optionally a new EPA arm.
     7. Push only with Jacob's go-ahead. Check `origin/main..main` for foreign commits first.
   - If Write to the SUMMARY is blocked, return its full text in the final message.
  </action>
  <verify>
    <automated>npx vitest run packages/harness/publish.test.ts apps/web/src/components/methodology/epaComparisonContent.test.ts && npx tsx scripts/captureCompareSlices.ts --diff experiments/260929-mat/compare-before.json experiments/260929-mat/compare-after.json</automated>
  </verify>
  <done>
- The 09h baseline is committed with spr and epa records, and its spr records equal 09g's.
- publish.ts points at 09h.
- The compare diff shows zero delta on every slice, and the after-capture passed every byte ceiling.
- Docs and copy are corrected, and their gates are green.
- The SUMMARY contains the calibration numbers and the owed-ops list.
- Committed.
- Nothing is published, deployed, seeded, pruned or pushed.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| TBA breakdown JSON -> EPA RP fold | third-party data parsed by the season rule module's zod schema before any slot moves |
| D1 state rows -> Worker deserialize | persisted state re-entering the live fold every tick |
| offline publish -> R2 artifacts -> browser | published numbers the community reads |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-260929-01 | Tampering | EPA RP fold from score_breakdown | medium | mitigate | parse through `ruleModule.parse` (zod) inside try/catch; non-finite probabilities throw in bonusMarginalRpPmf; the fold is skipped, never coerced, on any parse failure |
| T-260929-02 | Tampering | D1 epa rows | medium | mitigate | STATE_SNAPSHOT_SHAPE_VERSION 18 refuses stale rows; round-trip test; live-equals-offline digest test |
| T-260929-03 | Repudiation / integrity | published EPA numbers | high | mitigate | new major version 14.0.0 (no in-place overwrite); unchanged level 1 sha plus a zero-delta compare diff prove winner and score did not move |
| T-260929-04 | Information disclosure | .env credentials | high | mitigate | no step reads .env; all network ops are deferred to the main context |
| T-260929-05 | Denial of service | Worker tick cost | low | accept | a few sigmoids and length-4 convolutions per EPA predict; Workers Paid; no cpuTime bar per project rule |
</threat_model>

<verification>
- Before/after: `experiments/260929-mat/compare-before.json` is captured at the base SHA before any edit. The `--diff` against the final tree shows zero delta on every slice.
- The level 1 digest epa sha is unchanged under 14.0.0+baseline.
- SPR RP is unchanged: the 09h spr records deep-equal 09g's, the spr live-equals-offline digest is green, and the analyticPmf golden tests are green.
- EPA RP is present end to end:
  - the tracer publish test
  - the Worker live-equals-offline epa digest
  - the presim sidecar test
  - the web gate test
- The root `npx vitest run` shows no failures beyond the base list, and all three typechecks are clean.
</verification>

<success_criteria>
- EPA publishes Statbotics-method RP odds from its own state, and OPR publishes none.
- The Simulation tab works under EPA (start-match and pre-schedule) once the owed republish lands.
- EPA's winner, score and team metrics are provably unchanged, and the published rows move only by the added RP fields under a new major version.
- The live Worker keeps EPA RP odds current across ticks.
- Calibration is measured and recorded honestly, and every doc and page that stated the old rule is corrected.
</success_criteria>

<output>
Create `.planning/quick/260929-mat-add-statbotics-style-rp-odds-to-epa-and-/260929-mat-SUMMARY.md` when done. If Write is blocked for SUMMARY.md, return its full text in the final message instead. Do not use a heredoc.
</output>
