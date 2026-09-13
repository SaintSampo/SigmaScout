---
phase: 260913-qyn-score-total-ranking-points-on-the-rp-sco
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - scripts/measureRpCalibration.ts
  - scripts/measureRpCalibration.test.ts
  - packages/core/rankingPoints/analyticPmf.ts
  - packages/core/rankingPoints/analyticPmf.test.ts
  - packages/core/rankingPoints/fieldAveraged.test.ts
  - packages/core/algorithms/simulation/rankSimulation.test.ts
  - packages/harness/sigmaScoutLayer.ts
  - packages/harness/sigmaScoutLayer.outcomeArms.test.ts
  - packages/harness/sigmaScoutLayer.matchBand.test.ts
  - packages/harness/publish.ts
  - packages/harness/publish.test.ts
  - packages/harness/pageArtifacts.ts
  - packages/harness/pageArtifacts.test.ts
  - apps/worker/src/scheduled.ts
  - apps/worker/src/stateProbe.ts
  - apps/worker/test/scheduled.rp.test.ts
  - apps/web/src/components/compare/rpCalibrationCards.ts
  - apps/web/src/components/compare/rpCalibrationCards.test.ts
  - apps/web/src/components/compare/RpCalibrationSection.tsx
  - apps/web/src/components/compare/RpCalibrationSection.test.tsx
  - apps/web/src/routes/__fixtures__/rp-calibration-2026-spr.json
  - data/baselines/rp-outcome-arms-2026-09.json
  - data/baselines/rp-calibration-2026-09d.json
  - docs/models/rp-layer-config-arms.md
  - .planning/todos/pending/ranking-points-audit.md
  - .planning/todos/completed/rp-scorecard-measures-bonuses-only.md
autonomous: true
requirements: [QUICK-260913-qyn]

estimate:
  tokens: 180000
  raw_tokens: 360000
  tasks: 3
  confidence: high

must_haves:
  truths:
    - "The RP scorecard measures TOTAL ranking points: scripts/measureRpCalibration.ts emits, per (season, algorithm), a totalRp block (ranked probability score of redRpPmf/blueRpPmf against the actual alliance RP, pooled mean per alliance-side, plus mean predicted RP, mean actual RP and exclusion counts) and an outcome block (three-outcome Brier of matchOutcomePmf against match.winner, pooled mean per match, plus mean predicted tie probability and observed tie rate). Bonus-only fields are unchanged."
    - "Actual alliance RP in the scorer is produced by the same toIntegerRpOrNull(match.redRpEarned / blueRpEarned) path publish.ts uses for actualRedRp/actualBlueRp, imported, not re-derived."
    - "The acceptance bar (applyRpOutcomeArmBar: an arm set is accepted iff pooled totalRp RPS AND pooled outcome Brier are both strictly lower than control; ship the accepted set with the lowest RPS; WIN+TIE ships only if itself accepted) exists as committed code and a test in a commit that precedes the first arm measurement in git history."
    - "WIN, TIE and WIN+TIE were each measured on the selection slice (2016-2020, 2022, spr only) from one replay per season through SigmaScoutLayer, with the bonus half asserted bitwise identical to control on every folded match, and the committed record data/baselines/rp-outcome-arms-2026-09.json carries the figures and the bar's mechanical verdict."
    - "The measurement code refuses any season at or above 2023 and any algorithm other than spr for the arm comparison, before the corpus opens."
    - "Accepted arms are the unconditional behaviour of every Prediction-bearing RP call site (SigmaScoutLayer, Worker scheduled.ts, Worker stateProbe.ts, publish.ts pre-schedule pricer); rejected branches and the measurement seam are deleted; if nothing is accepted, default output is byte-identical to HEAD before this task."
    - "Live Worker RP equals offline RP (apps/worker/test/scheduled.rp.test.ts green, unedited or extended only), level-1 predictions are byte-identical (packages/harness/level1Digest.test.ts green, unedited), and any changed SPR RP digest literal carries a comment naming the arm and the record."
    - "A nonzero tie mass in matchOutcomePmf awards tieRp to both alliances in the rank simulation (a test proves it)."
    - "RP_CALIBRATION_MEASUREMENT_PATH points at data/baselines/rp-calibration-2026-09d.json, measured over 2016-2020,2022-2026 with spr from the post-ship code; -09b and -09c are untouched; the publish.test.ts literal-id block stays green."
    - "The Compare page RP card shows total-RP and win/tie/loss figures in plain language when the slice carries them, renders exactly as before when it does not, and the compare wire-budget test stays under its ceiling."
  artifacts:
    - path: "scripts/measureRpCalibration.ts"
      provides: "total-RP and outcome scorers, applyRpOutcomeArmBar, outcome-arm slice and algorithm guards, arm record schema"
      contains: "applyRpOutcomeArmBar"
    - path: "data/baselines/rp-outcome-arms-2026-09.json"
      provides: "committed arm comparison with per-arm pooled and per-season figures and the bar verdict"
    - path: "data/baselines/rp-calibration-2026-09d.json"
      provides: "published scorecard measurement with totalRp and outcome blocks for spr, ten seasons"
    - path: "packages/harness/pageArtifacts.ts"
      provides: "CompareRpCalibrationSchema optional totalRp and outcome blocks"
      contains: "totalRp"
    - path: "apps/web/src/components/compare/rpCalibrationCards.ts"
      provides: "plain-language total-RP and tie sentences built from record numbers"
  key_links:
    - from: "scripts/measureRpCalibration.ts"
      to: "packages/harness/publish.ts toIntegerRpOrNull"
      via: "import of the exported helper"
      pattern: "toIntegerRpOrNull"
    - from: "packages/harness/sigmaScoutLayer.ts #rpFieldsFor"
      to: "apps/worker/src/scheduled.ts rpFieldsFor"
      via: "identical analyticRpPmf inputs, proven by scheduled.rp.test.ts"
      pattern: "analyticRpPmf\\("
    - from: "packages/harness/publish.ts attachRpCalibration"
      to: "apps/web/src/components/compare/RpCalibrationSection.tsx"
      via: "slice.rpCalibration.totalRp / .outcome"
      pattern: "totalRp"
---

<objective>
Score total ranking points on the RP scorecard, then measure the two reverted Phase 9 outcome-half fixes for SPR (F6 WIN: the win half uses the algorithm's published pRedWin; F7 TIE: discrete integer-margin tie probability with a proportional three-way split) against a bar committed in advance, ship each accepted arm, re-emit the published measurement, and put the new figures on the Compare page.

Purpose: the pre-committed 09-06 bar scored bonuses only, so it could not see either fix (30 of 30 cells tied) and both were reverted. Win RP is the largest term in total RP, and the site today publishes no accuracy for it. This task adds a scorer that can see the win/tie half, measures honestly on the selection slice, and ships only what the bar accepts. Locked scope (decisions 1-7 in the orchestrator brief) is implemented exactly; nothing here revisits it.

Output: extended scorer and wire schemas, a committed bar and arm record, the collapsed RP model, `rp-calibration-2026-09d.json`, an extended Compare RP card, and dated docs. Republish, Worker deploy and presim refresh are OWED and out of scope (no network, no R2/D1, no deploy).
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.claude/CLAUDE.md
@.planning/todos/pending/ranking-points-audit.md
@.planning/todos/completed/rp-scorecard-measures-bonuses-only.md
@docs/models/rp-layer-config-arms.md
@scripts/measureRpCalibration.ts
@packages/core/rankingPoints/analyticPmf.ts
@packages/harness/sigmaScoutLayer.ts

Arm source code (read, do not restore wholesale): `git show 2731bfab^:packages/core/rankingPoints/analyticPmf.ts` — `TIE_MARGIN_HALF_WIDTH`, `tieProbability`, `splitOutcomeProbabilities`, and the `varianceD > 0` branch of that version's `matchOutcomeDistribution`.

## Environment hazards (binding on every task)

- Repo root: `C:/Users/Jacob/Documents/GitHub/SigmaScout`. Run on the MAIN tree (worktrees disabled: the replay reads gitignored `data/corpus.sqlite`). Never Read, cat or echo `.env`; nothing in this task needs it.
- Seven concurrent sessions share this checkout. At planning time these files you must edit ALREADY carry other sessions' uncommitted edits: `packages/harness/publish.ts`, `packages/harness/publish.test.ts` (quick task 260913-nvn, which is also moving page ceilings out of `docs/publish-budget.md` into `packages/harness/publishBudget.ts`). `packages/core/algorithms/spr.ts`, `data/baselines/level1-digest-2026-09.json` and `docs/publish-budget.md` are also dirty; do not edit them. Before the FIRST edit to any file, run `git diff --ignore-cr-at-eol --stat -- <file>`. If it shows changes you did not make, either wait for that session's commit, or at commit time stage only your own hunks: write `git diff -- <file>` to a patch in the scratchpad, delete the foreign hunks from the patch, `git apply --cached <patch>`, then confirm `git diff --cached -- <file>` shows only your hunks. Never `git add -A`, `git commit -a`, or staging a whole dirty file you share.
- Do not touch `experiments/`, `docs/models/rp-bonus-gap-attribution.md`, `apps/web/src/lib/bonusRp.ts`, `apps/web/src/components/**/BonusRpDots.tsx` (F4 probe and possible F10 work by other sessions).
- Long replays: start detached with PowerShell `Start-Process` (`-RedirectStandardOutput` and `-RedirectStandardError` to log files OUTSIDE the repo, e.g. the session scratchpad, `-WindowStyle Hidden -PassThru`, record the PID). If launched through Git Bash, escape PowerShell `$` variables. Judge completion ONLY by the log containing the script's final `wrote <path>` line; never by exit code, never by a quiet log (a quiet log is not a dead run: check the process by PID first).
- Tests: `npx vitest run <files>` from the repo root; never `timeout ... pnpm ...`. Typecheck all three: `npx tsc --noEmit -p .`, `npx tsc --noEmit -p apps/web`, `npx tsc --noEmit -p apps/worker` (root misses web errors). Attribute any red test to its cause before acting; other sessions' edits can break unrelated tests.
- Subagent SUMMARY.md writes are blocked: return the summary text; the orchestrator writes it.

## Design points the planner resolved (encode as written)

1. Seam for measurement without a production surface: optional inputs on `analyticRpPmf`/`matchOutcomeDistribution` (`pRedWin?: number`, `discreteMarginTie?: true`) plus an optional third constructor argument on `SigmaScoutLayer` (`rpOutcomeArms?: { readonly win?: boolean; readonly tie?: boolean }`). Absent means today's exact expressions. No production constructor passes it. The seam is deleted at ship time in every outcome of the bar.
2. RPS normalisation: `RPS = (1 / maxRp) * sum over k = 0..maxRp-1 of (P(RP <= k) - [actual <= k])^2`, where `maxRp = pmf.length - 1`. Bounded [0, 1]. Every selection-slice season has maxRp 4, so the normalisation cannot bias the arm comparison; it keeps 2025-2026 (maxRp 6) comparable on the published card.
3. Out-of-support actuals (integer RP below 0 or above maxRp, e.g. an offseason event with non-standard RP) are excluded and counted in `excludedOutOfSupport`, separately from `excludedNullActual`. Neither counts toward `count`.
4. Outcome Brier is the three-outcome sum `(pRed - [red])^2 + (pTie - [tie])^2 + (pBlue - [blue])^2` (0 perfect, 2 worst), per match, with the actual from `MatchResult.winner`. It is not comparable to the site's binary win Brier and the card must not imply it is.
5. Population: played matches with `isBonusRpCompLevel(match.compLevel)` whose folded prediction carries `redRpPmf` and `blueRpPmf` (outcome: `matchOutcomePmf`). NOT gated on `actualBonusFlagsForSeason` (the bonus loop's own `continue` must not skip the new scorers). A block is OMITTED from the record when its count is 0, the same absence discipline `bonuses` uses.
6. WIN at ship time: `pRedWin` stays an optional input whose absence is reserved for callers with no algorithm prediction. `packages/core/rankingPoints/fieldAveraged.ts` prices a hypothetical field-averaged match with no Prediction, so it keeps the score-draw limit; every call site holding a `Prediction` passes `prediction.pRedWin`. TIE at ship time collapses into `matchOutcomeDistribution` itself, so it reaches fieldAveraged (presim) too.
7. New wire and record fields are OPTIONAL in both `CompareRpCalibrationSchema` and publish.ts `RpCalibrationRecordSchema`, added in the same commit because `RpCalibrationRecord` is a compile-time-guarded alias of the wire type. Frozen `-09b`/`-09c` and live artifacts keep parsing.
8. `rp-scorecard-measures-bonuses-only.md` was already moved to `.planning/todos/completed/` by commit 8c109d9e (developer-reported). Do not move it again; append the dated RESOLVED note there.
9. `scripts/measureRpCalibration.test.ts` pins `-09b`'s `rpLayer` to `SHIPPED_RP_LAYER_LABEL`. If the label changes at ship, re-pin that frozen file to its own literal (`winSource=score-draw, tieModel=continuous-equality, marginal=gaussian`) with a comment, and pin `-09d` to the new constant. That is correct pinning of a frozen file, not weakening.

## Source coverage

| Source item | Task |
|---|---|
| Goal: total-RP scorecard, measure and re-ship F6/F7 | T1, T2, T3 |
| Decision 1 scores (totalRp RPS, outcome Brier, tie rates, toIntegerRpOrNull reuse, exclusions) | T1 |
| Decision 2 bar as code + test in own commit first; three arm sets; bonus half bitwise | T1 (bar), T2 (apply) |
| Decision 3 selection slice 2016-2020,2022, refuse 2023+, spr only | T1 (guards), T2 (run) |
| Decision 4 ship/collapse, Worker parity, level-1 digest, RP digest comment, rank-sim tie test | T2 |
| Decision 5 re-emit -09d, repoint, literal-id block green | T2 |
| Decision 6 compare schema, attach, web card, wire budget, sketch skill | T1 (schema), T3 |
| Decision 7 docs, audit F6/F7 rows, todo note | T3 |
| Audit F6/F7 decision step 3: re-measure the F6 gap under SPR | T1 (descriptive field), T2 (reported) |
</context>

<tasks>

<task type="tracer">
  <name>Task 1: Bar first, then inert arm inputs and the total-RP/outcome scorer, end to end through the measurement record</name>
  <files>scripts/measureRpCalibration.ts, scripts/measureRpCalibration.test.ts, packages/core/rankingPoints/analyticPmf.ts, packages/core/rankingPoints/analyticPmf.test.ts, packages/harness/sigmaScoutLayer.ts, packages/harness/sigmaScoutLayer.outcomeArms.test.ts, packages/harness/publish.ts, packages/harness/pageArtifacts.ts, packages/harness/pageArtifacts.test.ts</files>
  <behavior>
    - Bar: control RPS 0.30 Brier 0.50; arm RPS 0.29 Brier 0.49 is accepted; RPS 0.29 with Brier 0.50 (equal) is rejected; RPS 0.31 with Brier 0.40 is rejected; no tolerance anywhere.
    - Bar: WIN accepted at RPS 0.295, TIE accepted at 0.290, WIN+TIE rejected at 0.280 -> ship is "tie". All three accepted -> the lowest RPS ships. None accepted -> ship is "control".
    - Bar: an arm whose totalRp count or outcome count differs from control's throws; a non-finite figure throws; exact RPS equality between two accepted arms breaks on lower Brier, then on the fixed order win, tie, win+tie.
    - rankedProbabilityScore([0.5, 0.5, 0, 0, 0], 1) is 0.0625 (only k=0 contributes 0.25, divided by maxRp 4); a point mass on the actual scores 0; [1, 0, 0, 0, 0] with actual 4 scores 1.
    - outcomeBrier([0.6, 0.1, 0.3], "red") is 0.26; ([0.6, 0.1, 0.3], "tie") is 1.26.
    - Summary builders: a null actual increments excludedNullActual, an actual of 7 against a length-5 pmf increments excludedOutOfSupport, neither enters count or the means; zero observations omits the block.
    - matchOutcomeDistribution with neither new input is bitwise identical to today on the existing Test 4 rows; with pRedWin 0.73 and no tie input, pRedWin output === 0.73 exactly; with discreteMarginTie at meanD 0 and varianceD 36.5 squared, pTie is within 1e-6 of 0.0109297; the proportional split's decisive-share pRed/(pRed+pBlue) equals the supplied pRedWin within 1e-12; the varianceD <= 0 degenerate branch ignores both inputs.
    - SigmaScoutLayer on packages/harness/fixtures/digest-slice.json with spr: the default layer and a layer given an empty rpOutcomeArms produce bitwise-equal RP fields; the win layer's matchOutcomePmf[0] === prediction.pRedWin on every decomposed row; the tie layer has matchOutcomePmf[1] > 0 on some row; every arm layer's redBonusRpPmf, blueBonusRpPmf, redBonusRp and blueBonusRp are elementwise === control's.
    - Guards: assertOutcomeArmSliceAllowed(parseSeasons("2016-2026")) throws naming 2023-2026; ("2016-2020,2022") passes; the algorithm guard throws for anything other than exactly ["spr"].
  </behavior>
  <action>
Commit sequence matters: the bar lands in git before any arm code can produce a figure (decision 2). Do NOT run any arm measurement in this task.

Step 1, bar-as-code (its own commit). In scripts/measureRpCalibration.ts add, near the existing marginal-arm block, an exported type for the four arm names ("control", "win", "tie", "win+tie"), an exported interface for one arm's pooled figures (arm, totalRpCount, totalRpRps, outcomeCount, outcomeBrier), and exported pure function applyRpOutcomeArmBar(pooled) returning per-arm verdicts (arm, accepted, rpsDelta, brierDelta vs control) and the ship choice, implementing exactly the rule in the behavior block (decision 2: strict less-than on BOTH pooled RPS and pooled outcome Brier versus control; pick the accepted set with the lowest RPS; WIN+TIE ships only when itself accepted; per-season figures never enter it). Doc-comment it as the pre-committed bar for quick task 260913-qyn, dated 2026-09-13, and state it is applied mechanically without override. Add its tests to scripts/measureRpCalibration.test.ts. Run the bar tests, then commit only those two files: `test(260913-qyn): commit the outcome-arm acceptance bar before any arm is measured`.

Step 2, inert arm inputs. In packages/core/rankingPoints/analyticPmf.ts reintroduce TIE_MARGIN_HALF_WIDTH (0.5, structural), tieProbability (degenerate guard before division) and the proportional split from 2731bfab^ (pRedStrict = pRedWinEffective x (1 - pTie), pBlueStrict = (1 - pRedWinEffective) x (1 - pTie); clamp only a finite out-of-range pRedWin, let a non-finite one propagate to assertNormalizedPmf). Add optional `pRedWin?: number` and `discreteMarginTie?: true` to both RpOutcomeInput and AnalyticRpPmfInput; analyticRpPmf forwards them. In the varianceD > 0 branch, when NEITHER input is present, keep today's three expressions untouched so default output is byte-identical; when either is present, pRedWinEffective is the supplied pRedWin or the score-draw expression, pTie is tieProbability(meanD, varianceD) when discreteMarginTie is set or 0 otherwise, then split. Do not add a config object, labels, a support assertion or any tuned parameter (locked scope). In packages/harness/sigmaScoutLayer.ts add the optional third constructor parameter rpOutcomeArms (win, tie booleans), doc-commented as measurement-only for 260913-qyn and never passed by a publisher; #rpFieldsFor passes pRedWin: prediction.pRedWin when win is set and discreteMarginTie: true when tie is set, and passes neither key otherwise. Add the analyticPmf tests to analyticPmf.test.ts and create packages/harness/sigmaScoutLayer.outcomeArms.test.ts for the layer behaviors. Run those plus analyticPmfGolden.test.ts, sigmaScoutLayer.matchBand.test.ts, level1Digest.test.ts and apps/worker/test/scheduled.rp.test.ts: all must be green with no pinned literal edited (inertness proof). Commit: `feat(260913-qyn): inert win-source and discrete-tie inputs on the RP outcome half`.

Step 3, scorer and schemas (decision 1). Export toIntegerRpOrNull from packages/harness/publish.ts (one keyword; mind the foreign hunks in that file) and import it into the script, never re-deriving actual RP. Add exported pure helpers rankedProbabilityScore(pmf, actual), outcomeBrier(pmf3, winner), and summary builders producing the totalRp block (count, rankedProbabilityScore, meanPredictedRp as the mean of pmfMean over scored pmfs, meanActualRp, excludedNullActual, excludedOutOfSupport) and the outcome block (count, brierScore, meanPredictedTie, observedTieRate), per design points 2-5. Extend buildRpCalibrationRecord with an optional third argument carrying those observations and exclusion counts; it adds each block only when its count is above 0. In main(), collect the observations per (season, algorithm) BEFORE the bonus-flag `continue`, for every algorithm (OPR/EPA simply produce none). Add optional `totalRp` and `outcome` objects (integers nonnegative, figures finite) to CompareRpCalibrationSchema in packages/harness/pageArtifacts.ts and the structurally identical RpCalibrationRecordSchema in publish.ts in the same commit, keeping the compile-time guard compiling (design point 7). Add descriptive F6-gap figures to the console output (n, median, p90 and max of |matchOutcomePmf[0] - pRedWin|, favourite disagreements), labelled as not a gate.

Step 4, arm wiring and guards (decision 3). Add `--outcome-arms` and `--emit-outcome-arms <path>`. Guards run on the PARSED season list before openCorpusReadOnly: exported RP_OUTCOME_ARM_FORBIDDEN_FROM_SEASON = 2023 and assertOutcomeArmSliceAllowed (refuse, never trim, no override, message naming the reporting slice and the 2016-2020 plus 2022 selection slice), an exported algorithm guard requiring the resolved list to be exactly spr, and refusal when combined with --marginal-arm. With the flag, build one replay per season and fold the same records through four layers (control, win, tie, win+tie via the third constructor argument), score each arm with the SAME helpers, call an exported assertBonusHalfIdentical(control, arm, matchKey, armName) on every folded record (throws on any presence or elementwise === mismatch of the four bonus fields), assert per-arm counts equal control's, print pooled and per-season figures, apply applyRpOutcomeArmBar, and print the verdict. With --emit-outcome-arms, write a record validated by an exported RpOutcomeArmRecordSchema: measuredAt, command, corpusIdentity (path, sizeBytes, mtime as the attribution record does), algorithmVersions, seasons, per-arm pooled figures and per-season figures (season, totalRp and outcome blocks, meanPredictedTie, observedTieRate), f6Gap, bar verdicts and ship. Test the guards, assertBonusHalfIdentical and the new schemas (including that the committed apps/web/src/routes/__fixtures__/rp-calibration-2026-spr.json and data/baselines/rp-calibration-2026-09c.json still parse).

Step 5, tracer check on control only: detached, run `npx tsx scripts/measureRpCalibration.ts --seasons 2022 --algorithm spr --emit-artifact <scratchpad>/qyn-smoke.json` (NO --outcome-arms) and confirm from the log and the file that the 2022 spr record carries totalRp and outcome blocks with count above 0 and excludedOutOfSupport reported. Delete nothing in the repo for this; the smoke file lives outside it. Commit steps 3 and 4 as `feat(260913-qyn): score total RP and the win/tie/loss outcome on the RP scorecard`.
  </action>
  <verify>
    <automated>npx vitest run scripts/measureRpCalibration.test.ts packages/core/rankingPoints/analyticPmf.test.ts packages/core/rankingPoints/analyticPmfGolden.test.ts packages/harness/sigmaScoutLayer.outcomeArms.test.ts packages/harness/sigmaScoutLayer.matchBand.test.ts packages/harness/level1Digest.test.ts packages/harness/pageArtifacts.test.ts apps/worker/test/scheduled.rp.test.ts && npx tsc --noEmit -p . && npx tsc --noEmit -p apps/web && npx tsc --noEmit -p apps/worker</automated>
    <automated>git log --format=%s -n 5 -- scripts/measureRpCalibration.ts | grep -n "acceptance bar"</automated>
  </verify>
  <done>Three commits exist in order (bar, inert inputs, scorer plus arm wiring); the bar commit is the oldest of the three. Pinned digests, the analyticPmf golden, the level-1 digest and the Worker RP parity test are green with no literal edited. A control-only 2022 spr smoke record carries non-empty totalRp and outcome blocks. No arm figure has been produced.</done>
</task>

<task type="auto">
  <name>Task 2: Measure the three arm sets, apply the bar mechanically, ship or collapse, prove parity, re-emit -09d</name>
  <files>data/baselines/rp-outcome-arms-2026-09.json, scripts/measureRpCalibration.ts, scripts/measureRpCalibration.test.ts, packages/core/rankingPoints/analyticPmf.ts, packages/core/rankingPoints/analyticPmf.test.ts, packages/core/rankingPoints/fieldAveraged.test.ts, packages/core/algorithms/simulation/rankSimulation.test.ts, packages/harness/sigmaScoutLayer.ts, packages/harness/sigmaScoutLayer.outcomeArms.test.ts, packages/harness/sigmaScoutLayer.matchBand.test.ts, packages/harness/publish.ts, apps/worker/src/scheduled.ts, apps/worker/src/stateProbe.ts, apps/worker/test/scheduled.rp.test.ts, data/baselines/rp-calibration-2026-09d.json</files>
  <precondition>data/corpus.sqlite exists, and `git log` shows Task 1's bar commit before its scorer commit.</precondition>
  <action>
Step 1, measure (decisions 2 and 3). Detached, run `npx tsx scripts/measureRpCalibration.ts --seasons 2016-2020,2022 --algorithm spr --outcome-arms --emit-outcome-arms data/baselines/rp-outcome-arms-2026-09.json`. Wait for the log's `wrote` line. If assertBonusHalfIdentical or a count assertion throws, STOP: commit nothing, and return a report to the orchestrator naming the arm, match and field. If a genuine scorer defect is found after figures exist, fix it in its own commit with the reason in the message, re-run the identical command once, and record both runs in the docs (Task 3); never alter the bar. Commit the record alone: `data(260913-qyn): measure WIN, TIE and WIN+TIE against the committed bar on the selection slice`. Add a test to scripts/measureRpCalibration.test.ts that parses the committed record and asserts applyRpOutcomeArmBar over its pooled figures reproduces its recorded verdicts and ship, and that its seasons are exactly 2016, 2017, 2018, 2019, 2020, 2022.

Step 2, ship or collapse, following the record's ship value with no override (decision 4, 09-06 D-06 convention). In every outcome, delete the SigmaScoutLayer third constructor argument, the --outcome-arms and --emit-outcome-arms flags and the four-layer fold, keeping the READER half: applyRpOutcomeArmBar, RpOutcomeArmRecordSchema, the scorers, the slice and algorithm guards (doc them as the guard any future outcome-arm re-measurement must reuse) and the record test. Then per arm:
- TIE accepted: matchOutcomeDistribution's varianceD > 0 branch always computes tieProbability and the proportional split; remove the discreteMarginTie input. Rewrite the function's header comment (it currently says the tie model was refused) to state what shipped, when, and the record path. Update analyticPmf.test.ts Test 4's `pTie toBe 0` row to hand-computed discrete-margin expectations (that file's hand-computed convention), and fix fieldAveraged.test.ts only where it asserted a zero tie.
- TIE rejected: delete discreteMarginTie, tieProbability and TIE_MARGIN_HALF_WIDTH; add a dated line to the header comment recording the 2026-09-13 re-measurement and record path.
- WIN accepted: keep pRedWin optional per design point 6 and pass pRedWin: prediction.pRedWin at all four Prediction-bearing call sites: SigmaScoutLayer #rpFieldsFor, apps/worker/src/scheduled.ts rpFieldsFor, apps/worker/src/stateProbe.ts rpFieldsFor (it mirrors the Worker), and the pre-schedule pricer in publish.ts that calls analyticRpPmf. fieldAveraged.ts passes nothing, and a comment there says why.
- WIN rejected: delete the pRedWin input from both interfaces.
- Neither accepted: after deletion the model is exactly HEAD-before-this-task; the proportional split helper goes too.
Update SHIPPED_RP_LAYER_LABEL to the shipped combination in the existing label format and apply design point 9 to the -09b pin. Rework sigmaScoutLayer.outcomeArms.test.ts to assert the SHIPPED identities on the default two-argument layer: WIN shipped means matchOutcomePmf[0]/(matchOutcomePmf[0]+matchOutcomePmf[2]) within 1e-12 of pRedWin; TIE shipped means some row has matchOutcomePmf[1] > 0; the bonus half is bitwise equal to a pinned digest of the four bonus fields captured BEFORE the collapse edit.

Step 3, parity and digests. Before the collapse edit, confirm sigmaScoutLayer.matchBand.test.ts is green; after it, if its spr PINNED_RP_DIGESTS literal fails, replace it only when an arm shipped, with a dated comment naming the shipped arm(s), the record path and the bar verdict, following the 260913-it4 precedent (a developer-decided model change, not a refresh). apps/worker/test/scheduled.rp.test.ts must pass unedited; if TIE shipped, EXTEND it with a non-vacuity assertion that some live decomposed row carries matchOutcomePmf[1] > 0. packages/harness/level1Digest.test.ts must pass unedited. In packages/core/algorithms/simulation/rankSimulation.test.ts add a test: a remaining match whose outcome pmf is [0, 1, 0] with a zero bonus pmf adds exactly tieRp to both alliances' totals in every draw (checked the way Test 8 checks averages), and a match whose outcome pmf carries 0.25 tie mass under a fixed mulberry32 seed awards tieRp to both alliances together on the same draws with a draw share between 0.2 and 0.3. Run the full root suite with `npx vitest run` and the three typechecks; attribute every failure before acting. Commit the collapse, stating the shipped set in the message.

Step 4, re-emit the published measurement (decision 5). Detached, run `npx tsx scripts/measureRpCalibration.ts --seasons 2016-2020,2022-2026 --algorithm spr --emit-artifact data/baselines/rp-calibration-2026-09d.json` from the post-ship tree. Repoint RP_CALIBRATION_MEASUREMENT_PATH to it with a dated doc comment in the file's existing REPOINTED style (why: total RP and outcome now scored, and what shipped). Leave -09b and -09c byte-untouched. Add a -09d block to scripts/measureRpCalibration.test.ts: parses, rpLayer equals SHIPPED_RP_LAYER_LABEL, every spr record has totalRp and outcome blocks with count above 0. As a REPORTED check (not a test), compare -09d's per-bonus figures with -09c's and its selection-slice pooled totalRp/outcome figures with the record's shipped arm; explain any difference (for example a foreign SPR commit) in the return text. Run publish.test.ts's "RP_CALIBRATION_MEASUREMENT_PATH" block and the compare wire-budget test in whatever form it has at execution time. Commit: `data(260913-qyn): re-emit rp-calibration-2026-09d with total-RP and outcome scores, repoint`.
  </action>
  <verify>
    <automated>npx vitest run scripts/measureRpCalibration.test.ts packages/harness/sigmaScoutLayer.outcomeArms.test.ts packages/harness/sigmaScoutLayer.matchBand.test.ts packages/harness/level1Digest.test.ts apps/worker/test/scheduled.rp.test.ts packages/core/algorithms/simulation/rankSimulation.test.ts packages/core/rankingPoints/ packages/harness/publish.test.ts && npx tsc --noEmit -p . && npx tsc --noEmit -p apps/web && npx tsc --noEmit -p apps/worker</automated>
    <automated>node -e "const r=require('./data/baselines/rp-outcome-arms-2026-09.json');const d=require('./data/baselines/rp-calibration-2026-09d.json');if(!r.ship||d.records.filter(x=>x.algorithmId==='spr'&&x.calibration.totalRp&&x.calibration.outcome).length!==10)process.exit(1);console.log('ship='+r.ship)"</automated>
  </verify>
  <done>The arm record is committed before the collapse and its verdict is reproduced by a test. Accepted arms are unconditional at all four Prediction-bearing call sites, and rejected branches plus the measurement seam are gone. Worker parity and level-1 digest pass unedited (parity may be extended), and any changed RP digest carries its arm comment. The rank-simulation tie test passes. -09d holds ten spr records with totalRp and outcome blocks, RP_CALIBRATION_MEASUREMENT_PATH points at it, and the literal-id and wire-budget tests are green.</done>
</task>

<task type="auto">
  <name>Task 3: Publish the total-RP and outcome figures on the Compare card, write the dated docs, close the loop</name>
  <files>packages/harness/publish.ts, packages/harness/publish.test.ts, packages/harness/pageArtifacts.test.ts, apps/web/src/routes/__fixtures__/rp-calibration-2026-spr.json, apps/web/src/components/compare/rpCalibrationCards.ts, apps/web/src/components/compare/rpCalibrationCards.test.ts, apps/web/src/components/compare/RpCalibrationSection.tsx, apps/web/src/components/compare/RpCalibrationSection.test.tsx, docs/models/rp-layer-config-arms.md, .planning/todos/pending/ranking-points-audit.md, .planning/todos/completed/rp-scorecard-measures-bonuses-only.md</files>
  <behavior>
    - attachRpCalibration copies totalRp and outcome when the record has them, rounding figures to 6 decimals and leaving counts as integers; a record without them yields a slice whose rpCalibration has no totalRp or outcome key.
    - buildRpCalibrationCard returns totalRp and outcome models (with sparse flags from SPARSE_N) when present, and null for each when absent; the bonus headline and rows are unchanged.
    - The total-RP sentence and the tie sentence are built only from record numbers and always print the sample count; a record without the new blocks renders the card exactly as today, with no total or tie line and no invented zero.
  </behavior>
  <action>
Load `Skill("sketch-findings-sigmascout")` and read its references/simulation-and-compare.md and uncertainty-display.md BEFORE any UI edit; follow plain-language-first calibration, mandatory sample counts, sparse flags, and its rule that differences too small to call render as ties (decision 6).

Wire: in publish.ts attachRpCalibration, carry totalRp and outcome per the behavior block. Refresh apps/web/src/routes/__fixtures__/rp-calibration-2026-spr.json from the 2026 spr record in -09d, keeping the file's current structure (read it first), so pageArtifacts.test.ts and the section test exercise a real record with the new blocks. Extend pageArtifacts.test.ts and publish.test.ts attach tests for presence and absence. Run the compare wire-budget test; if it exceeds its ceiling, shrink the new blocks on the wire (drop exclusion counts from attach first), never raise a ceiling.

Web: in rpCalibrationCards.ts add the totalRp and outcome models and two exported sentence builders. The total sentence follows the shape "<label> expected about X ranking points per alliance per match, and alliances actually earned Y, across N alliance results." and the tie sentence follows "<label> gave a tie about P% chance on average, and Q% of these N matches actually tied." Use fmtPct and the skill's rounding and tie-display rules rather than raw floats. In RpCalibrationSection.tsx lead each card with the total sentence, then the tie sentence, then two plainly labelled secondary figures: "Total ranking point score (0 is perfect)" for RPS, and "Win, tie and loss Brier score (0 is perfect, 2 is worst)" for the three-outcome Brier, which must never sit beside the site's binary Brier as if comparable. Under a small "Bonus ranking points" sub-label, keep the existing bonus headline sentence, chart and rows unchanged, including their test ids. Add new test ids for the total and tie sentences. Rewrite RP_CALIBRATION_EXPLAINER so it says the card covers total ranking points (win, tie and bonus) and that the rows below cover bonus points only, keeping its provenance sentence. Colour only through existing tokens. Extend both web test files for presence, absence and sample-count printing.

Docs (decision 7): append a dated section "Re-measured under a total-RP scorer (2026-09-13, quick task 260913-qyn)" to docs/models/rp-layer-config-arms.md with the scorer definitions (design points 2-5), the slice and guards, a table of control, win, tie and win+tie pooled RPS, outcome Brier, mean predicted tie and observed tie rate with counts and deltas, the per-season figures (reported, not gating), the F6 gap under SPR, the bar commit hash, the record path, the verdict and what shipped or was deleted, any re-run from Task 2, and a note that republish, Worker deploy and presim refresh are owed. Re-read .planning/todos/pending/ranking-points-audit.md IMMEDIATELY before editing it (another session edits its F4 section), then use scoped Edit replacements on the F6 / F7 row of the "STATUS 2026-09-13" table and append a dated outcome paragraph at the end of its "F6 / F7 decision" subsection only. Touch nothing else in that file. Append a dated "RESOLVED 2026-09-13 by quick task 260913-qyn" section to .planning/todos/completed/rp-scorecard-measures-bonuses-only.md (design point 8) saying total RP and the win/tie/loss outcome are now scored and carried to the Compare card, pending republish. Run the web and harness tests plus the web typecheck, check git status, and commit by explicit path: `feat(260913-qyn): total-RP and win/tie/loss figures on the Compare RP card, dated docs`.
  </action>
  <verify>
    <automated>npx vitest run apps/web/src/components/compare/ packages/harness/pageArtifacts.test.ts packages/harness/publish.test.ts scripts/measureRpCalibration.test.ts && npx tsc --noEmit -p apps/web && npx tsc --noEmit -p .</automated>
    <automated>grep -c "260913-qyn" docs/models/rp-layer-config-arms.md .planning/todos/pending/ranking-points-audit.md .planning/todos/completed/rp-scorecard-measures-bonuses-only.md</automated>
    <human-check>After the owed republish, open /methodology/compare, pick 2025 and 2026, and confirm the SPR card leads with the total-RP and tie sentences, the bonus rows sit under their sub-label, and an older artifact (or a year without the new blocks) renders the bonus-only card with no empty total line. Desktop and phone-390.</human-check>
  </verify>
  <done>The Compare RP card carries plain-language total-RP and tie figures plus labelled RPS and three-outcome Brier when present, and is unchanged when absent. Wire budget is green. The arms doc has a dated section with figures and verdict. The audit's F6/F7 row and decision subsection are updated with nothing else in that file touched. The completed scorecard todo carries the dated RESOLVED note. Everything is committed by explicit path.</done>
</task>

</tasks>

<verification>
- `git log --oneline` shows, in order: the bar commit, inert inputs, scorer plus arm wiring, the arm record, the collapse, -09d re-emit, and the card plus docs.
- Root `npx vitest run` is green, or every red test is attributed to another session's uncommitted work with file and cause named. All three typechecks are clean.
- `data/baselines/rp-outcome-arms-2026-09.json` verdict equals applyRpOutcomeArmBar over its own pooled figures (test).
- level1Digest.test.ts and scheduled.rp.test.ts carry no edits except an optional TIE non-vacuity extension to the latter: `git diff <bar-commit>^ -- packages/harness/level1Digest.test.ts` is empty.
- No file under experiments/, bonusRp.ts, BonusRpDots.tsx, spr.ts, level1-digest-2026-09.json, publish-budget.md, -09b or -09c appears in any of this task's commits.
</verification>

<success_criteria>
- Total RP and the win/tie/loss outcome are scored walk-forward through SigmaScoutLayer and published in the measurement and wire schemas.
- The bar predates every arm figure in git, and it was applied mechanically. Each accepted arm ships at every Prediction-bearing call site, and each rejected arm is deleted.
- Offline equals live RP, level 1 is byte-identical, and the rank simulation honours tie mass.
- -09d is the repointed published measurement, and the Compare card shows the new figures in plain language.
- The summary text names the shipped set, the pooled deltas, the F6 gap under SPR, and that republish, Worker deploy and presim refresh are owed.
</success_criteria>

<output>
Return the SUMMARY text to the orchestrator (do not Write it); the orchestrator writes `.planning/quick/260913-qyn-score-total-ranking-points-on-the-rp-sco/260913-qyn-SUMMARY.md`.
</output>
