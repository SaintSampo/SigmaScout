---
task: "Measure whether BPR or EPA better reconstructs observed alliance output at Championship-level play, walk-forward"
slug: measure-whether-bpr-or-epa-better-recons
quick_id: 260910-vbr
date: 2026-09-10
mode: quick
type: execute
wave: 1
depends_on: []
autonomous: true
requirements: [REC-01, REC-02, REC-03, REC-04, REC-05]
files_modified:
  - scripts/measureAllianceReconstruction.ts
  - scripts/measureAllianceReconstruction.test.ts
  - package.json

estimate:
  tokens: 120000
  raw_tokens: 60000
  tasks: 3
  confidence: low

must_haves:
  truths:
    - "A new read-only measurement script reconstructs each alliance's expected output for opr, epa and bpr from each model's OWN pre-match prediction, walk-forward, and scores it against the actual alliance output."
    - "The scored population is broken out by event tier — regional/district (control), district championship (warm control), Championship division, Einstein — and reported separately for EVERY season the corpus covers, so a single-season fluke is visible as one."
    - "Per model per bucket the script reports n, MAE, RMSE and SIGNED mean error, so systematic over/under-prediction is readable separately from magnitude."
    - "The corrected target is `totalPoints - foulPoints - adjustPoints`, computed by importing `correctionsOf` from packages/core/algorithms/bpr.ts — never a second transcription of that arithmetic."
    - "OPR and EPA natively target RAW total points while BPR targets the corrected output; the script reports BOTH targets for all three models and prints the native-target mismatch as a named finding rather than normalizing it away."
    - "The hypothesis (BPR's rank weighting reconstructs stacked alliances better) is REFUTABLE by this measurement: the script prints an explicit verdict line that says so when BPR loses or when the paired interval spans zero."
    - "Zero production model code is changed and no parameter is tuned, fit, searched or selected against any season — `git status --porcelain -- packages apps` is empty at the end of the task."
    - "The script was actually RUN over the full default season range and the real numbers are transcribed into the SUMMARY."
  artifacts:
    - scripts/measureAllianceReconstruction.ts
    - scripts/measureAllianceReconstruction.test.ts
  key_links:
    - "WalkForwardSimulator.runAll <-> the observation stream — runAll is the repo's leak-proof predict-before-update guarantee; a hand-rolled replay loop would void it."
    - "correctionsOf (packages/core/algorithms/bpr.ts) <-> the corrected scoring target — the same function BPR's update() uses, so the measurement target cannot drift from the training target."
    - "prediction.redScore/blueScore <-> each model's OWN alliance reconstruction — BPR's is the rank-weighted `red.mu * unit`, NOT a plain sum; forcing a sum on BPR would test the opposite of the hypothesis."
    - "eventType 3/4 <-> the Championship split — teamRanks.ts already names these two constants; 2/5 are DISTRICT championship and must not be folded in."
    - "eventBlockedBootstrap (packages/harness/eventBootstrap.ts) <-> the paired BPR-vs-EPA contrast — Einstein is ~1 event per season, so the effective sample size is events, not matches."
---

<objective>
Build and run a read-only diagnostic that answers one question with a number:
at Championship-level play, does BPR or EPA better reconstruct the alliance
output that actually happened?

Purpose: on the published 2026 artifacts, aggregated over teams whose last
official event was a Championship division, `sum(BPR)/sum(OPR) = 1.128` while
`sum(EPA)/sum(OPR) = 0.968`. The two shipped models disagree by ~16% on exactly
the teams the front page ranks. A ratio cannot say which is right. Predictive
reconstruction can.

Output: `scripts/measureAllianceReconstruction.ts` + its unit tests + a
`package.json` entry + the actual measured numbers in the SUMMARY.

## THE HYPOTHESIS IS ON TRIAL, NOT ON DISPLAY

The hypothesis under test: BPR's rank weighting (`w2`/`w3` in
`packages/core/algorithms/bpr.ts`) reconstructs a STACKED alliance better than
OPR's and EPA's linear-sum assumption can.

Read `viewOfMap`'s doc comment before writing a line of this script. Quick task
260910-25c already corrected the story there: because the weights are
renormalized to sum to 3 and the LARGEST weight lands on the LARGEST rating,
BPR's weighted sum is **>= the plain sum for every alliance** (Chebyshev), with
the gap growing as the alliance's ratings spread out. BPR is a SPREAD
AMPLIFIER, not an anti-additivity discount. That is the opposite of what the
motivating framing assumes, and it makes a specific, checkable prediction: if
the amplification is wrong, BPR's SIGNED error at stacked fields should be
POSITIVE — it should over-predict.

The script must be able to return that answer. Build the verdict line so it
prints "BPR loses" as fluently as it prints "BPR wins", and so it prints
"indistinguishable" when the paired interval spans zero.

## GROUND RULES — READ TWICE

1. **This is a pure measurement over BPR's sealed 2023-2026 holdout. Read-only.**
   Do NOT tune, fit, sweep, search, or select ANY parameter against these years.
   Do NOT edit any model's parameters or code. Doing so converts the sealed
   holdout into a training set and voids the project's headline holdout claim.
2. **No production code changes at all.** The only files this task may touch are
   the two under `scripts/` and one added line in `package.json`.
3. **Do not consult or port pre-v3 implementations** (REBUILD_SPEC.md clean slate).
4. **Never render `.env` into any output stream** — this script needs no secrets
   and must not take `--env-file`. See CLAUDE.md "Secrets handling".
5. Worktree isolation is DISABLED and must stay disabled: `data/corpus.sqlite`
   is gitignored and would not exist inside a worktree.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@./.claude/CLAUDE.md
@.planning/STATE.md

@scripts/measureSwingSkill.ts
@scripts/measureRpCalibration.ts
@scripts/measureSwingSkill.test.ts
@packages/harness/replay.ts
@packages/core/algorithms/bpr.ts
@packages/harness/score.ts
@packages/bpr/evaluate.ts
@packages/core/algorithms/eventTypes.ts
</context>

## Facts already established by planning — do not re-derive

These were read out of the codebase and the corpus during planning. Treat them
as given; spending context re-confirming them is the thing this section exists
to prevent.

**Each model's own alliance reconstruction is already `prediction.redScore` /
`prediction.blueScore`.** `WalkForwardSimulator.runAll` calls `predict` strictly
before `update`, so those two fields ARE "this model's expected alliance output
from its team values as of before the match", walk-forward by construction. Do
not reach into `teamMetrics` and re-sum; that would force a plain sum onto BPR
and test the opposite of the hypothesis.

- `bpr.predict`: `redScore = red.mu * unit`, `unit = state.scale / 3`, where
  `red.mu` is the **rank-weighted** sum from `viewOfMap` (weights renormalized
  to sum to 3). Points. Trained against the CORRECTED target.
- `opr.predict`: plain sum of that team's **event-scoped** rating. Raw points.
  Trained against raw `result.redScore` (fouls included).
- `epa.predict`: `redScore = redOffensiveTotal + blue's predicted
  foulsCommitted`. Raw points — it deliberately adds the opponent's foul
  contribution, so it targets raw total.

**BPR's corrected target is `result.redScore - foulPoints - adjustPoints`**
(`bpr.ts` `update`, line ~717, via the exported `correctionsOf(raw)`), settled
by commit `7c88e234`. `correctionsOf` returns `{redFoul, blueFoul, redAdjust,
blueAdjust}` and yields all-zero corrections for a `null` or malformed
breakdown.

**Event types** (`teamRanks.ts` already names the first two):
`3` = Championship Division, `4` = Championship Finals (Einstein),
`2`/`5` = District Championship, `0`/`1` = Regional/District,
`6` = Festival of Champions, `99` = Offseason, `100` = Preseason Week 0.
`isOfficialEventType` (`eventTypes.ts`) excludes only 99 and 100 — it does NOT
identify Championship play, so it cannot do this bucketing on its own.
`EVENT_TYPE_TIERS` in `packages/core/rankingPoints/constants.ts` collapses 3 and
4 into one `championship` tier and therefore must NOT be reused here.

**Championship coverage in `data/corpus.sqlite`** (verified by direct query):

| season | division (t3) matches / events | Einstein (t4) matches / events |
|---|---|---|
| 2016 | 1126 / 8 | 18 / 1 |
| 2017 | 1552 / 12 | 34 / 2 |
| 2018 | 1553 / 12 | 34 / 2 |
| 2019 | 1552 / 12 | 36 / 2 |
| 2022 | 851 / 6 | 18 / 1 |
| 2023 | 1160 / 8 | 15 / 1 |
| 2024 | 1118 / 8 | 15 / 1 |
| 2025 | 1125 / 8 | 16 / 1 |
| 2026 | 1119 / 8 | 16 / 1 |

2020 is present but truncated with no Championship; 2021 is absent entirely.
**Default season range is therefore `2016-2019,2022-2026`.** Einstein is ~1-2
events per season — the effective sample size for an Einstein claim is EVENTS
(11 of them across all seasons), not the ~200 matches.

**Scoring-population exclusions** the repo already defines — follow these, do
not invent a rule:
- surrogate-affected: `redSurrogates.length > 0 || blueSurrogates.length > 0`
  (`packages/bpr/data.ts` `isSurrogateAffected`, `score.ts` D-07) — whole match
  leaves the scoreboard, never the state stream.
- cold start: `record.coldStart === true`, the stamp `runAll` sets (D-01/D-02).
- fully-demo alliance: `isFullyDemoAlliance` (`packages/core/algorithms/demoTeams.ts`).
- DQ-zeroed side: `isFullyDqZeroScoreAlliance(teams, dqs, actualScore)`
  (`packages/core/algorithms/dq.ts`) — per SIDE, as `measureSwingSkill.ts` does.
- offseason/preseason: never scored, regardless of whether it is replayed.

**Season-boundary threading**: `packages/harness/cli.ts` `runSeasons` (lines
~712-770) is the shape to mirror — `seasonBoundaryFor(seasons, i)` from
`packages/harness/seasonBoundary.ts`, then `algorithm.carrySeason(priorState,
boundary)` for every algorithm that has one, feeding `runAll`'s `initialStates`,
and reading `records.carryStates` back out at the end of each season. OPR has no
`carrySeason` and is deliberately left out of the map.

<tasks>

<task type="tracer">
  <name>Task 1: End-to-end reconstruction measurement — one season, one table</name>
  <precondition>`data/corpus.sqlite` exists in the repo root (582 MB, gitignored). If absent, HALT — this task cannot be simulated.</precondition>
  <files>scripts/measureAllianceReconstruction.ts</files>
  <action>
Create the script with a `measureSwingSkill.ts`-style file-header doc comment
that states what is measured, WHY (the 1.128-vs-0.968 disagreement), the
hypothesis under test, and — explicitly — the refutation condition. Quote
`viewOfMap`'s corrected spread-amplifier finding in that header so a reader
cannot walk away with the anti-additivity framing.

Wire ONE path all the way through, for a single season, all three published
algorithms:

1. `openCorpusReadOnly("data/corpus.sqlite")`, `corpusColdStartIndex(db)`,
   `resolvePublishAlgorithms(undefined)` (defaults to the published set:
   opr, epa, bpr) — the same four imports `measureSwingSkill.ts` already uses.
2. `buildSeasonStream(db, season)` (offseason excluded by default), derive the
   team list from the stream, then ONE
   `new WalkForwardSimulator(stream, coldStartIndex).runAll(algorithms, teams)`
   call for all three algorithms over the shared stream. Per REC-01 all three
   must ride the SAME stream in the SAME run so any difference is the model and
   not the data.
3. For each record, emit up to TWO observations (red and blue), each carrying:
   `season`, `eventKey`, `matchKey`, `eventType`, `tier`, `compLevel`, `side`,
   `algorithmId`, `predicted` (`prediction.redScore`/`blueScore` verbatim),
   `actualRaw` (`match.redScore`/`blueScore`), `actualCorrected`, `rosterSize`.
4. `actualCorrected` comes from `correctionsOf(match.scoreBreakdownRaw)`
   imported from `packages/core/algorithms/bpr.ts` — `raw - foul - adjust`.
   Import it; never re-transcribe the arithmetic.
5. Exclusions, applied exactly as the repo defines them (see the facts section
   above): drop the whole match on surrogate-affected, on `coldStart === true`,
   and on a fully-demo alliance; drop the individual SIDE on
   `isFullyDqZeroScoreAlliance` or on a non-finite predicted/actual value. Count
   every exclusion into a census — counted, never silently dropped, per D-07's
   rule that a narrowed population must announce itself.
6. Bucket by event tier via a pure `tierOf(eventType)` returning
   `"base" | "districtChampionship" | "champsDivision" | "einstein" |
   "festivalOfChampions"`, or `null` for 99/100 (replayed but never scored).
   Throw on an unmapped type, mirroring `eventTierFor`'s documented
   refuse-to-default stance. 3 and 4 stay SEPARATE; 2 and 5 are district
   championship and must not be folded into Championship.
7. Print one table: rows = (algorithm x tier), columns = n, MAE, RMSE, signed
   mean error, against the CORRECTED target. Print the exclusion census beneath
   it.

Put every statistic and every classifier in pure exported functions above a
`// ─── pure ───` divider, following `measureSwingSkill.ts`'s layout, so Task 3
can unit-test them. Guard `main()` with the same `isEntryPoint` idiom
`measureSwingSkill.ts` uses so the test file can import the pure helpers without
opening a corpus.

Do NOT reach into `teamMetrics`. Do NOT sum team values by hand. Do NOT
normalize OPR/EPA onto BPR's target yet — that is Task 2's explicit finding, not
a silent fix.
  </action>
  <verify>
    <automated>npx tsx scripts/measureAllianceReconstruction.ts --seasons 2026 2>&1 | tail -40</automated>
  </verify>
  <done>The single command above prints a real table with finite MAE/RMSE/signed values for opr, epa and bpr, with non-zero `n` in the `base`, `champsDivision` and `einstein` rows, plus an exclusion census. No file under `packages/` or `apps/` is modified.</done>
</task>

<task type="auto">
  <name>Task 2: Dual target, season breakout, controls, and the paired contrast</name>
  <files>scripts/measureAllianceReconstruction.ts</files>
  <action>
Expand the proven slice outward. Five additions, all reporting — the observation
stream from Task 1 is unchanged except for two extra fields.

**(a) Multi-season with boundary threading.** Loop the default season range
`2016-2019,2022-2026` (overridable with `--seasons`, parsed by the same
range/list grammar `measureSwingSkill.ts` uses). Thread state across boundaries
by mirroring `cli.ts`'s `runSeasons` loop exactly: `seasonBoundaryFor(seasons,
i)`, `algorithm.carrySeason(priorState, boundary)` into `initialStates`,
`records.carryStates` out. Reference `runSeasons` in a comment as the shape
being mirrored and say why a fresh-per-season run would be wrong here: the
control bucket is full of week-1 matches, so starting every season cold would
handicap the control and manufacture a Championship advantage that is really
just late-season warmth.

**(b) Both targets, reported side by side, never reconciled.** Report every
metric against BOTH `actualCorrected` and `actualRaw`, for all three models.
Above the tables, print a NATIVE TARGET line naming which target each model
actually trains on — `opr: raw`, `epa: raw`, `bpr: corrected` — and state in
prose that this is a real comparability finding: OPR's and EPA's signed error
against the corrected target carries the mean foul load as a floor and must not
be read as model bias. This is REC-03's explicit surfacing requirement; do not
subtract fouls out of OPR's or EPA's prediction to "fix" it.

**(c) Per-season blocks plus pooled.** One block per season (tier rows within
it) so a single-season fluke reads as one season, then a pooled block. State the
n-is-not-independent caveat the way `measureSwingSkill.ts`'s header does: two
observations per match share a field, a game state and an officiating crew.

**(d) The two controls that make the Championship number mean anything.**
  - Tier control: `base` (regional/district) is the headline control, and
    `districtChampionship` is the WARM control. Championship is both stacked AND
    late-season; district championship is late-season but much less stacked. If
    BPR's advantage shows up at champs but not at DCMP, the stacking story
    survives the lateness confound. If it shows up at DCMP too, it does not.
  - Strength control: add `strengthRef` to each observation — OPR's predicted
    alliance score for the SAME side of the SAME match (available because all
    three algorithms ride one `runAll`). Report a quintile table of `strengthRef`
    computed WITHIN the `base` tier only. This asks the hypothesis's real
    question without Championship at all: if BPR already beats EPA on the top
    strength quintile of ordinary regionals, the effect is about alliance
    strength, not about Championship, and the Championship framing is the wrong
    frame.

**(e) The paired contrast with an event-blocked interval.** For the pairs
(bpr, epa) and (bpr, opr), per tier: compute the per-observation paired
difference in ABSOLUTE error (`|err_bpr| - |err_other|`, both models scored on
the identical observation), then run it through `eventBlockedBootstrap` from
`packages/harness/eventBootstrap.ts` with its defaults. Report the point
estimate, the standard error, the 2.5/97.5 percentile interval, AND
`eventCount` — for Einstein `eventCount` is around 11 across all seasons, which
is the honest effective sample size and the reason the interval will be wide.
`eventBlockedBootstrap` throws below 2 event blocks; catch that and print
"too few event blocks to bootstrap" rather than crashing a nine-season run.

**(f) The verdict line.** After the tables, print a pre-registered verdict per
tier in plain language, covering all three outcomes:
  - BPR's MAE lower AND the paired percentile interval excludes zero -> supported
  - interval spans zero -> "indistinguishable at this sample size"
  - BPR's MAE higher AND interval excludes zero -> "REFUTED"
Print the signed-error direction alongside it, because the spread-amplifier
reading predicts BPR OVER-predicts stacked alliances and a positive signed error
at `einstein`/`champsDivision` is that prediction landing.

Every new statistic goes in a pure exported function above the divider.
  </action>
  <verify>
    <automated>npx tsx scripts/measureAllianceReconstruction.ts --seasons 2025-2026 2>&1 | tail -80</automated>
  </verify>
  <done>Output carries per-season blocks, both targets for all three models, the NATIVE TARGET comparability note, base/districtChampionship/champsDivision/einstein rows, a base-tier strength-quintile table, paired bootstrap intervals reporting `eventCount`, and a verdict line per tier. Still no file under `packages/` or `apps/` modified.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Unit tests, wiring, the full run, and the numbers</name>
  <files>scripts/measureAllianceReconstruction.test.ts, package.json</files>
  <behavior>
Test only what can be silently wrong in a way no console output would reveal —
the standard `measureSwingSkill.test.ts` sets, matching its header's reasoning.
  - `mae` / `rmse` / `signedMean` over a known list; `signedMean` keeps sign
    where `mae` does not (feed `[-5, +5]`: mae 5, signedMean 0 — the one case
    that proves the two columns are not the same number twice).
  - each returns `NaN` on an empty list, never 0.
  - `tierOf`: 3 -> champsDivision and 4 -> einstein as SEPARATE values (the
    regression that matters — `EVENT_TYPE_TIERS` collapses them); 2 and 5 both
    -> districtChampionship; 0 and 1 -> base; 6 -> festivalOfChampions;
    99 and 100 -> null; an unregistered type throws.
  - `correctedOutputs` wrapper: a synthetic breakdown JSON with known
    `foulPoints`/`adjustPoints` on both sides subtracts both; a `null` raw
    string yields the raw score unchanged; malformed JSON yields the raw score
    unchanged rather than throwing.
  - the side-exclusion predicate: a surrogate-affected match is excluded, a
    `coldStart` record is excluded, a DQ-zeroed side is excluded while its
    healthy opposite side is kept, and an ordinary side is kept.
  - the paired-difference builder pairs by `(matchKey, side)` and drops any
    observation without a counterpart in the other model — never zero-fills,
    which would silently dilute the contrast toward zero.
  - the seasons-spec parser expands a range, accepts a comma-separated mix, and
    de-duplicates.
  </behavior>
  <action>
Write `scripts/measureAllianceReconstruction.test.ts` importing only the pure
exports, following `measureSwingSkill.test.ts`'s structure and its
header-comment convention (state what is tested and why the console output
cannot catch it).

Reuse rather than re-implement: if an equal-population bucketer is needed for
the strength quintiles, import `equalCountBuckets` from `./measureSwingSkill.js`
— it is already exported and already unit-tested there, and that module's
`isEntryPoint` guard means importing it opens no corpus. Note the reuse in a
comment.

Wire `package.json`: add `"measure:alliance-reconstruction": "tsx
scripts/measureAllianceReconstruction.ts"` immediately after the existing
`measure:swing-skill` line. `package.json` is already modified in the working
tree — add the one line, do not rewrite the file, and do not add
`--env-file=.env` (this script needs no secrets).

Then RUN IT. A script that was never run is not a measurement. Run the full
default range in the BACKGROUND (2-3 minutes, nine seasons x ~180k matches x
three algorithms) and capture the output to a file under the scratchpad, then
read the file. Do not wrap the run in `timeout` and do not judge it by exit
code — read the output.

Transcribe the ACTUAL numbers into the SUMMARY: the per-tier MAE / RMSE /
signed-error table for all three models against both targets, the paired
bpr-vs-epa interval and its `eventCount` at `champsDivision` and at `einstein`,
the base-tier strength-quintile table, and the verdict line verbatim. Report
what was measured even if — especially if — it refutes the hypothesis. A
negative result here is a real result; the project's log already records one
case of a claim that was never checked.

Finally, confirm the discipline gate held.
  </action>
  <verify>
    <automated>npx vitest run scripts/measureAllianceReconstruction.test.ts 2>&1 | tail -30 && npx tsc --noEmit 2>&1 | tail -20 && echo "MODEL-CODE GATE:" && git status --porcelain -- packages apps</automated>
  </verify>
  <done>All unit tests pass (read the output, not the exit code); the root typecheck is clean; `git status --porcelain -- packages apps` prints nothing; `pnpm measure:alliance-reconstruction` resolves; and the SUMMARY carries the real measured numbers from a completed full-range run including the verdict line.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| repo working tree -> git history | a leaked secret or an unintended model-code edit becomes permanent |
| `.env` -> agent transcript | live TBA + R2 credentials; rotation was already forced once by exactly this path |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-vbr-01 | Information disclosure | `.env` | high | mitigate | This script takes no secrets and must not be run with `--env-file`. Never `Read`/`cat`/`echo` `.env`. CLAUDE.md "Secrets handling". |
| T-vbr-02 | Tampering | sealed 2023-2026 holdout | high | mitigate | Read-only measurement; no tuning, fitting, or parameter selection against any season. Task 3's `git status --porcelain -- packages apps` gate must print nothing. |
| T-vbr-03 | Tampering | npm/pip/cargo installs | high | mitigate | No new dependencies are added by this task — the gate is vacuous here. `better-sqlite3`, `tsx` and `vitest` are already installed. |
| T-vbr-04 | Repudiation | the reported numbers | medium | mitigate | The script prints its own exclusion census, `eventCount` per bootstrap, and the native-target mismatch, so a reader can audit the population the headline was computed on. |
| T-vbr-05 | Information disclosure | `data/corpus.sqlite` | low | accept | Public TBA data, already gitignored; no new exposure path is created. |
</threat_model>

<verification>
- `npx vitest run scripts/measureAllianceReconstruction.test.ts` — all green, verified by reading output.
- `npx tsc --noEmit` — clean.
- `git status --porcelain -- packages apps` — empty. This is the holdout-integrity gate; if it prints anything, stop and revert before committing.
- A completed full-range run whose output is quoted in the SUMMARY.
</verification>

<success_criteria>
- Championship divisions and Einstein are reported separately, per season, for every season the corpus covers.
- The regional/district control and the district-championship warm control are reported alongside them.
- MAE, RMSE and SIGNED mean error are all present per model per bucket, against both the corrected and the raw target.
- The OPR/EPA-target-raw vs BPR-target-corrected mismatch is stated as a finding, not normalized away.
- The verdict line reflects what was measured, in whichever of the three directions the evidence actually points.
- No production model code changed; no parameter tuned or selected against any season.
</success_criteria>

<output>
Create `.planning/quick/260910-vbr-measure-whether-bpr-or-epa-better-recons/260910-vbr-SUMMARY.md` when done, with the real numbers in it.
</output>
