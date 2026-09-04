---
phase: quick-260904-oiu
plan: "01"
subsystem: tuning-harness
tags: [vpr, sigma1, tuning, acceptance, brier, winner-accuracy, event-blocked-bootstrap]

requires:
  - phase: quick-260901-trz
    provides: eventBlockedBootstrap (event-blocked paired-difference SE), D-T5 rolling-origin selection, D-T7's pre-committed acceptance rule
provides:
  - "packages/core/scoring/brier.ts's exported accuracyCall predicate, shared by scoreSet and the tuner's own accuracy blocks"
  - "packages/harness/objectiveDefinition.ts: one definition site for the search and screen objective sentences, imported by tune.ts and promote.ts"
  - "A noise-band lexicographic comparator (compareCandidates) in tune.ts: accuracy primary, Brier the within-band tie-break"
  - "An accuracy-primary D-T7 ship/don't-ship bar in acceptance.ts, with Brier demoted to a two-half guardrail veto alongside the existing MAE veto"
affects: [future VPR re-tune runs, any future reader of promoted version files' provenance.objective]

actuals:
  tokens: 30127
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Noise-band lexicographic comparator: maximize a primary metric, fall back to a secondary metric only inside the primary's own measured noise band (event-blocked paired-difference SE)"
    - "One objective-definition leaf module imported by two writers (tune.ts's artifacts, promote.ts's provenance) so a promoted file's objective string cannot silently diverge from what the search actually optimizes"

key-files:
  created:
    - packages/harness/objectiveDefinition.ts
  modified:
    - packages/core/scoring/brier.ts
    - packages/harness/tune.ts
    - packages/harness/tune.test.ts
    - packages/harness/acceptance.ts
    - packages/harness/acceptance.test.ts
    - packages/harness/promote.ts
    - .planning/PROJECT.md
    - .claude/CLAUDE.md
    - docs/models/sigma1-sensitivity-screen.md
    - docs/models/sigma1-tuning-results.md

key-decisions:
  - "Noise-band comparator: accuracy is primary and maximized; Brier decides only when two candidates' accuracy differs by less than one event-blocked paired-difference standard error of the accuracy delta (eventBlockedBootstrap, seed unchanged for determinism)"
  - "D-T7's ship bar moved from Brier to accuracy (sqrt(2 ln N) x SE_paired(accuracy delta)); Brier became a second two-half guardrail veto (relative + noise-distinguishability halves, mirroring the MAE veto's shape) rather than a tuned objective"
  - "Veto precedence: MAE veto checked before Brier veto, so a candidate tripping both still reports mae-veto — the ten already-recorded D-T7 verdicts' vocabulary does not shift underneath them"
  - "The screen stage deliberately stays Brier-based (SCREEN_OBJECTIVE_DEFINITION), documented as an intentional divergence from the joint search's objective, not a bug"
  - "provenance.objective's UNITS now differ across a promoted file's promotedAt date (Brier before this task, accuracy after); provenance.objectiveDefinition is the field that disambiguates which quantity a given file's number is"

patterns-established:
  - "A pure predicate (accuracyCall) extracted from scoreSet so any downstream accuracy computation (the tuner's per-event blocks, the acceptance path's paired units) shares one correctness rule and cannot re-derive a drifted copy"

requirements-completed: [OBJ-RANK, OBJ-BAR, OBJ-DOCS]

duration: ~2h
completed: 2026-09-04
status: complete
---

# Quick Task 260904-oiu: Accuracy-primary VPR tuning objective Summary

Flipped the VPR (Sigma1) tuning objective so winner accuracy is primary and Brier is a
secondary/guardrail signal, at both the search-ranking stage (`tune.ts`) and the D-T7
ship/don't-ship bar (`acceptance.ts`) — via a noise-band lexicographic comparator built on the
project's existing event-blocked paired-difference bootstrap.

## Performance

- **Duration:** ~2h
- **Completed:** 2026-09-04
- **Tasks:** 3/3 completed
- **Files modified:** 11 (1 created, 10 modified)

## Accomplishments

- **The noise-band comparator (OBJ-RANK).** `packages/core/scoring/brier.ts` exports a pure
  `accuracyCall` predicate (extracted from `scoreSet`, byte-identical behavior), so the tuner's
  new per-event accuracy blocks (`buildEventAccuracyBlocks`) and `scoreSet`'s own published
  `winnerAccuracy` can never drift apart — proven by an anti-drift test comparing the two
  computations on a shared fixture (tie + 0.5 no-call included). `tune.ts`'s `EvaluatedCandidate`
  now carries `accuracyObjective` (primary, maximized) and `brierObjective` (secondary, minimized)
  instead of a single retired `objective`. `compareCandidates` decides which of two candidates
  wins: accuracy if the delta exceeds `accuracyDeltaStandardError` (the noise band, an
  `eventBlockedBootstrap` paired SE over per-event accuracy blocks), otherwise the lower-Brier
  candidate, otherwise an exact tie. `determineWinner` routes through the comparator — including
  the tracer stage, which shares `determineWinner` with the joint stage — preserves the
  earlier-generation-wins tie-break discipline, and now returns `noiseBandResolvedCount` so how
  often Brier actually decided a comparison is visible rather than hidden inside the comparator.
  The joint stage's coordinate-descent refinement pass is rewired through the same comparator so
  refinement and final ranking can never disagree.
- **The D-T7 accuracy bar with a Brier guardrail (OBJ-BAR).** `acceptance.ts`'s `decideAcceptance`
  now gates on `candidateAccuracy - incumbentAccuracy` against `sqrt(2 ln N) *
  SE_paired(accuracy delta)` — the same union-bound formula as the retired Brier bar, applied to a
  different standard error. Brier joins score-MAE as a second two-half guardrail veto
  (`ACCEPTANCE_BRIER_VETO_RELATIVE_TOLERANCE = 0.01`, `ACCEPTANCE_BRIER_VETO_NOISE_MULTIPLE = 2`,
  mirroring the MAE veto's shape and justified against the same ~0.17 Brier scale). Precedence is
  bar first, then MAE veto, then Brier veto, so the ten already-recorded verdicts' reason
  vocabulary (`below-threshold` / `mae-veto`) does not shift underneath them; `brier-veto` is the
  new third reason. `keep-incumbent` remains a calmly-reported success for all four outcomes, and
  the shared verdict prefix stays sign-neutral (carrying forward quick task 260904-4ik's fix).
  `tune.ts`'s acceptance path (`PairedOriginUnit`, `scoreOriginRows`, `buildPairedOriginUnits`,
  `evaluateOriginSeason`, `buildAcceptanceReport`) now carries a shared accuracy denominator and
  both models' correct-call flags through a fourth paired bootstrap call, using `brier.ts`'s
  `accuracyCall` — never a local re-derivation — and refuses (by name) a per-match accuracy
  denominator mismatch between the two models.
- **Docs and the stale-objective sweep (OBJ-DOCS).** `packages/harness/objectiveDefinition.ts` is
  the one place the search objective (`SEARCH_OBJECTIVE_DEFINITION`) and the screen objective
  (`SCREEN_OBJECTIVE_DEFINITION`, deliberately still Brier-based, with the sensitivity rationale
  stated) are written in words, imported by both `tune.ts`'s artifacts and `promote.ts`'s
  `provenance.objectiveDefinition` writers — no second literal to drift. `.planning/PROJECT.md`'s
  Core Value (and its `.claude/CLAUDE.md` mirror) now reads "proven by walk-forward backtests
  scored on winner accuracy first and Brier second." `docs/models/sigma1-sensitivity-screen.md`
  carries a dated 2026-09-04 note explaining the screen/search objective split is now deliberate.
  `docs/models/sigma1-tuning-results.md` carries a dated note that all ten already-recorded D-T7
  verdicts were decided under the retired Brier bar, with nothing below it retro-edited. No
  present-tense "the search minimizes Brier" claim survives in `packages/` (verified by grep).

## Scope discipline

No tuning was run. No promoted version file, prediction digest, baseline fingerprint, or
`reports/` artifact was regenerated or edited by this task — verified via `git status` after every
commit (only the eleven files this plan named changed). A re-tune under the new accuracy-primary
objective remains a separate, deliberately-scheduled item, as does re-evaluating the ten
already-recorded D-T7 verdicts under the new bar.

## Verification

- `npx tsc --noEmit` — clean.
- `npx vitest run` (full repo scope, 175 test files) — 3175 passed, 4 skipped (pre-existing),
  0 failed.
- `npx vitest run packages/harness packages/core/scoring` — 942 passed, 0 failed (re-verified
  after the `promote.ts` edits landed).
- `grep -rn "minimized (D-01)" packages/` — no matches.
- `grep -rn "Brier-scored backtests" .planning/PROJECT.md .planning/STATE.md .claude/CLAUDE.md` —
  no matches.
- `docs/models/sigma1-sensitivity-screen.md` and `docs/models/sigma1-tuning-results.md` each
  carry a `2026-09-04` dated note (2 and 3 occurrences respectively).

## Task Commits

1. **Task 1: The noise-band comparator, wired end to end through the search** - `d983d168` (feat)
2. **Task 2: D-T7 — accuracy bar, Brier guardrail veto** - `b942f81d` (feat)
3. **Task 3: Docs, the stale-objective sweep, and a full-scope test run** - `b97e3401` (docs)

**Commit organization note:** `tune.ts`/`tune.test.ts` carry both Task 1's comparator wiring and
Task 2's acceptance-path accuracy fields, since the two tasks' actions land in the same functions
(`scoreOriginRows`, `buildAcceptanceReport`) and could not be cleanly split by file. Task 1's
commit therefore also includes `tune.ts`/`tune.test.ts`'s Task-2-scoped hunks; Task 2's commit is
`acceptance.ts`/`acceptance.test.ts` only. Both commits are independently green (verified via the
harness/core-scoring test run recorded above).

`.planning/STATE.md`'s Core Value mirror was updated in the working tree (matching Task 3's
action) but deliberately left uncommitted by this executor, per the standing rule that
STATE.md/SUMMARY.md/PLAN.md/CONTEXT.md are committed by the orchestrator, not per-task.

## Deviations from Plan

### Auto-fixed Issues

None — plan executed as written. `promote.ts`'s `runPerSeasonPromotion` top-level
`objectiveDefinition` literal (a general description of what the field means across
`paramSetsBySeason` entries, not one of the plan's two explicitly named writer sites) also made a
present-tense claim that the search "minimizes mean selection-season brierScore." Rewrote it to
defer to each entry's own `sourceArtifact`/`objectiveDefinition.ts` rather than restate a
retired rule — in scope under OBJ-DOCS's "no stale objective prose survives in `packages/`"
must-have, and `promote.ts` was already a file this plan names.

## Known Stubs

None.

## Self-Check: PASSED

All eleven files-of-record found on disk; all three task commits (`d983d168`, `b942f81d`,
`b97e3401`) found in `git log`.
