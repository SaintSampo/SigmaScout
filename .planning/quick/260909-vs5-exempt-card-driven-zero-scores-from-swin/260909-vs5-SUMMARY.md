---
phase: quick-260909-vs5
plan: 01
subsystem: rating-pipeline
tags: [swing-factor, dq, typescript, vitest, live-offline-parity]

requires:
  - phase: quick-260904-6a1
    provides: dq.ts's isFullyDqZeroScoreAlliance / isAdjustZeroedAlliance — the whole-alliance-DQ zero-score predicate already applied by EPA and Sigma1
  - phase: quick-260909-tgf
    provides: Swing Factor promoted to a published, tiered metric (which is what made this bug visible)
provides:
  - "SwingFactorAccumulator.foldMatch skips a fully-DQ'd, exactly-zero-score alliance's own observation, leaving the opponent's real observation folding normally"
  - "SwingFoldMatch/SwingFoldPrediction structural parameter types, with DQ keys required rather than optional or defaulted"
  - "Six unit tests pinning the skip/no-skip/no-decay behaviours"
affects: [swing-factor, rarity-tiers, republish]

actuals:
  tokens: 3531
  tasks: 3
  commits: 2

tech-stack:
  added: []
  patterns:
    - "Structural (not imported-type) parameter interfaces for a cross-package function signature, so every existing caller's own object is assignable with no risk of positional-argument transposition"
    - "Required, never-optional/defaulted fields as the typecheck-level enforcement of a live/offline parity contract"

key-files:
  created: []
  modified:
    - packages/harness/swingFactor.ts
    - packages/harness/swingFactor.test.ts
    - packages/harness/sigmaScoutLayer.ts
    - apps/worker/src/scheduled.ts
    - apps/worker/test/scheduled.replay.test.ts

key-decisions:
  - "Applied only isFullyDqZeroScoreAlliance (full-DQ-flag encoding), not the sibling isAdjustZeroedAlliance (breakdown-parsed adjustPoints encoding) — neither fold site parses breakdowns, and applying an offline-only predicate the Worker cannot evaluate would break the live/offline bit-equality contract (D1)"
  - "foldMatch changed from six positional parameters to two structural object parameters (SwingFoldMatch, SwingFoldPrediction) with DQ keys required, never optional/defaulted, so a caller cannot silently omit them and still typecheck (D4)"
  - "The DQ skip is a separate per-alliance guard, evaluated after the existing isFullyDemoAlliance whole-match early return, which stays first and unchanged (D5)"

patterns-established:
  - "A structural interface narrower than the domain type (MatchResult/Prediction) as a function's parameter type, so every real caller's own object is assignable and tests can build minimal literals"

requirements-completed: [QT-260909-vs5]

coverage:
  - id: D1
    description: "A fully-DQ'd, zero-score alliance's card-driven zero no longer folds into any of its three teams' Swing Factor beliefs"
    requirement: "QT-260909-vs5"
    verification:
      - kind: unit
        ref: "packages/harness/swingFactor.test.ts#a card is a ruling, not evidence: a fully-DQ'd zero-score alliance does not fold"
        status: pass
    human_judgment: false
  - id: D2
    description: "The opposing (non-DQ'd) alliance in the same match still folds normally"
    requirement: "QT-260909-vs5"
    verification:
      - kind: unit
        ref: "packages/harness/swingFactor.test.ts#the opposing alliance still folds when the other side is carded"
        status: pass
    human_judgment: false
  - id: D3
    description: "A skipped alliance consumes no decay step — interleaved-carded and carded-absent accumulators agree to 12 decimal places"
    requirement: "QT-260909-vs5"
    verification:
      - kind: unit
        ref: "packages/harness/swingFactor.test.ts#a skipped fold consumes no decay step — an interleaved carded match changes nothing"
        status: pass
    human_judgment: false
  - id: D4
    description: "Partial DQ and non-zero-score whole-alliance DQ both still fold normally; the demo whole-match early return is unchanged and still runs first"
    requirement: "QT-260909-vs5"
    verification:
      - kind: unit
        ref: "packages/harness/swingFactor.test.ts#a partial DQ still folds — dq.ts measures that population as genuinely bad-but-real play"
        status: pass
      - kind: unit
        ref: "packages/harness/swingFactor.test.ts#a whole-alliance DQ with a non-zero score still folds — the zero, not the DQ, is what triggers the skip"
        status: pass
      - kind: unit
        ref: "packages/harness/swingFactor.test.ts#the demo rule still drops the whole match — the DQ change does not disturb its ordering"
        status: pass
    human_judgment: false
  - id: D5
    description: "Live Worker and offline publisher stay bit-identical on the Match Band stream after the foldMatch signature change across all three callers"
    requirement: "QT-260909-vs5"
    verification:
      - kind: integration
        ref: "apps/worker/test/scheduled.replay.test.ts online/offline prediction-stream and band digest comparison"
        status: pass
    human_judgment: false
  - id: D6
    description: "Visual/data check after the developer's republish — a team with a carded match no longer shows a depressed Swing Factor or a wrongly-Common rarity tier"
    verification: []
    human_judgment: true
    rationale: "Requires a live republish (out of scope by this task's own network fence) and a read of real data. Developer follow-up item."

duration: ~15min
completed: 2026-09-10
status: complete
---

# Quick Task 260909-vs5: Exempt card-driven zero scores from Swing Factor — Summary

**`SwingFactorAccumulator.foldMatch` now skips a whole-alliance-DQ'd, exactly-zero-score alliance's own observation via `isFullyDqZeroScoreAlliance`, per-alliance rather than whole-match, across all three live/offline call sites in one commit.**

## Performance

- **Duration:** ~15 min
- **Tasks:** 3 (2 produced commits; Task 3 was gate-verification-only)
- **Files modified:** 5

## Accomplishments

- `foldMatch` moved from six positional parameters to two structural object parameters (`SwingFoldMatch`, `SwingFoldPrediction`) with DQ keys required, never optional or defaulted — the mechanical enforcement of the live/offline parity contract.
- A card-driven, exactly-zero-score whole-alliance DQ no longer poisons its three teams' Swing Factor beliefs (and, since 260909-tgf, their rarity tiers); the opponent's real observation in the same match still folds normally.
- A skipped alliance consumes no decay step — verified to 12 decimal places against an accumulator that never saw the carded match at all.
- Partial DQs and non-zero-score whole-alliance DQs still fold normally (dq.ts's own documented, deliberately narrow scope), and the pre-existing `isFullyDemoAlliance` whole-match drop is unchanged and still evaluated first.
- All three `foldMatch` callers — the offline publisher, the live Worker, and the replay test's hand-maintained offline mirror — updated together in the same commit; the replay test's live/offline Match Band digest (with its non-vacuity guard) stayed green throughout.

## Task Commits

1. **Task 1: Teach foldMatch the DQ predicate and update all three callers in one edit** — `10b2371f` (feat)
2. **Task 2: Pin all six behaviours with non-vacuous tests** — `0629a54b` (test)
3. **Task 3: Full-suite gates, then commit by explicit path** — no new commit (gate-verification only; the five plan files were already committed atomically in Tasks 1–2)

## Files Created/Modified

- `packages/harness/swingFactor.ts` — `SwingFoldMatch`/`SwingFoldPrediction` interfaces, `foldMatch` rewritten to apply `isFullyDqZeroScoreAlliance` per alliance alongside the unchanged `isFullyDemoAlliance` early return
- `packages/harness/swingFactor.test.ts` — six new tests in a `foldMatch — card-driven zero scores` describe block (20 total, was 14)
- `packages/harness/sigmaScoutLayer.ts` — offline publisher's `foldMatch` call updated to the two-argument object form
- `apps/worker/src/scheduled.ts` — live Worker's `foldMatch` call updated to the two-argument object form
- `apps/worker/test/scheduled.replay.test.ts` — the replay test's hand-maintained offline mirror updated to match, keeping it a faithful mirror of the offline publisher

## Decisions Made

- Followed CONTEXT.md's locked decisions D1–D6 exactly: only the full-DQ-flag predicate, per-alliance (not whole-match) skip, no-decay-on-skip, all three callers changed together, demo-check composition order preserved, explicit-path staging.
- No deviations from the plan's specified signature shape, doc-comment content, or test structure.

## Planning-Time Finding

CONTEXT.md's D4 named **two** `foldMatch` call sites. There are **three**. The third is
`apps/worker/test/scheduled.replay.test.ts:506` — the parity test's own hand-maintained
offline mirror, which exists because `apps/worker` cannot import
`packages/harness/replay.ts` (a better-sqlite3 `URL` ambient collision). Missing it would
not merely have broken a test; it would have **disarmed the exact gate protecting D4**,
and the suite would have looked healthy. The planner caught this and it was verified
independently before dispatch.

## Orchestrator Re-verification (2026-09-10)

Checked directly rather than taken from the executor's report:

- `git show --stat` on both commits — exactly the intended files, nothing foreign absorbed
  despite concurrent sessions committing throughout (`627feed2` landed mid-run).
- `grep -rn "\.foldMatch("` across the repo — all three production call sites carry the
  two-argument object form.
- The two full-suite failures (`packages/gbr/seal.test.ts`, `packages/harness/digest.test.ts`)
  were re-run and their assertions read: a GBR 2026 holdout row count of 20408 against an
  expected 20297, and VPR fixture-vs-corpus slice-list mismatches. Both are **corpus-data**
  failures. `data/corpus.sqlite` is gitignored and was modified at 22:49 today by a
  concurrent session; neither of this task's commits touches it. Not caused by this change,
  and it is a LOCAL red rather than a committed one.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

- The repo-root full-suite gate surfaced 6 pre-existing failures across
  `packages/gbr/seal.test.ts` and `packages/harness/digest.test.ts`. Attributed to a
  concurrent session's local corpus mutation — see the re-verification section above for
  the evidence. Judged environmental, not auto-fixed, and left for the developer since it
  affects other in-flight work rather than this task.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- **The republish.** This change alters published Swing Factor values and therefore the
  rarity tiers added by 260909-tgf. A republish is required for the fix to reach the site
  and was deliberately NOT performed — the executor is network-sandboxed and the republish
  is the developer's follow-up step. It now covers **two** stacked changes (260909-tgf's
  tiers and this DQ exemption).
- **The local corpus red.** `packages/gbr/seal.test.ts` and `packages/harness/digest.test.ts`
  are failing against the current local `data/corpus.sqlite`. Worth resolving before the
  republish, since a corpus that disagrees with committed fixtures is exactly the state a
  publish reads from.
- **The deferred `isAdjustZeroedAlliance` case.** Still unwired at both fold sites, exactly
  as D1 specifies. dq.ts measures it at 4 alliance-sides (`adjustPoints <= -30`) or 13 at
  the full `< 0` threshold, spanning 2019–2026. Any pickup needs its own task with its own
  Worker breakdown-parsing plumbing measurement.

---
*Phase: quick-260909-vs5*
*Completed: 2026-09-10*
