---
phase: 06-team-pages
plan: 02
subsystem: data-pipeline
tags: [zod, schema, sigma1, published-artifact, rounding]

# Dependency graph
requires:
  - phase: 04-publish-live-update-pipeline
    provides: TeamSeasonArtifactSchema/TeamSeasonMatchSchema, ROUNDING_RULE, the publish-time rounding boundary
  - phase: 02-prediction-models-epa-sigma1
    provides: Sigma1's predict()/covariance.ts, the D-09/D-10 two-± convention
provides:
  - "Prediction.redScoreVarianceOwn/blueScoreVarianceOwn (D-01) — Sigma1 populates, OPR/EPA leave undefined"
  - "TeamSeasonMatchSchema fields for D-01/D-02/D-08: redScoreVarianceOwn, blueScoreVarianceOwn, actualRedRp, actualBlueRp, setNumber, matchNumber, sortTime"
  - "TeamSeasonMatchSchema D-09 relaxation: actualWinner/actualRedScore/actualBlueScore optional, replaced by a played-match cross-field refine"
  - "TeamMetricSchema.percentile (D-04), bounded [0, 100]"
  - "TeamSeasonArtifactSchema.robotImageUrl (D-03) and activeYears (D-05)"
  - "ROUNDING_RULE.percentile = 1"
affects: [06-03-team-page-ui, 06-04-publisher-wiring, 06-05, 06-06, 06-07, 06-08, 06-09]

# Actuals (#2632)
actuals:
  tokens: 6984
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Rebuild a .refine()-chained ZodEffects object literal (cannot .extend()) when adding fields to it — same constraint PredictionRecordSchema already carries"
    - "Cross-field .refine() as the replacement for a type-level required-field guarantee, proven by a documented revert-and-count regression check before committing"

key-files:
  created: []
  modified:
    - packages/core/algorithms/types.ts
    - packages/core/algorithms/sigma1/index.ts
    - packages/core/algorithms/sigma1/sigma1.test.ts
    - packages/harness/pageArtifacts.ts
    - packages/harness/pageArtifacts.test.ts
    - packages/harness/rounding.ts
    - packages/harness/rounding.test.ts

key-decisions:
  - "actualRedRp/actualBlueRp null contract resolved against packages/ingest/normalize.ts's extractRp (not rp/constants.ts, which has no opinion on this): null means 'not derivable from available data' (no score_breakdown, or a breakdown missing the rp/tba_rpEarned field) — never 'this event tier has no RP rules' (TBA reports a real value, commonly 0, for every played match including eliminations) and never coerced to 0."
  - "TEAM-03/TEAM-04/TEAM-05 left Pending in REQUIREMENTS.md — this plan ships the schema/algorithm-side plumbing only (fields exist, all optional); no publisher wiring (06-04) and no client UI (06-03+) exists yet to make any of the three requirements user-visible. Matches this repo's established ALGO-03/ALGO-04 precedent of not marking a shared multi-plan requirement complete until the plan that actually closes it lands."

patterns-established:
  - "A .refine()-chained ZodEffects schema gets new fields by rebuilding its object literal wholesale, not .extend()."

requirements-completed: []

coverage:
  - id: D1
    description: "Sigma1's predict() publishes each alliance's own predicted-score variance (redScoreVarianceOwn/blueScoreVarianceOwn) instead of discarding it after the RP pmf computation; OPR/EPA leave both fields undefined"
    requirement: "TEAM-05"
    verification:
      - kind: unit
        ref: "packages/core/algorithms/sigma1/sigma1.test.ts#sigma1.predict — D-01 own-variance publish (Phase 6)"
        status: pass
    human_judgment: false
  - id: D2
    description: "TeamSeasonMatchSchema carries every D-01/D-02/D-08 field, all optional, so a pre-republish artifact still parses"
    requirement: "TEAM-05"
    verification:
      - kind: unit
        ref: "packages/harness/pageArtifacts.test.ts#TeamSeasonMatchSchema — D-01 own-variance and D-02 actual RP fields (Phase 6, plan 06-02 Task 3)"
        status: pass
    human_judgment: false
  - id: D3
    description: "D-09's type-level guarantee (a played match always has a result) is replaced by a cross-field .refine(), proven to fail when removed"
    requirement: "TEAM-04"
    verification:
      - kind: unit
        ref: "packages/harness/pageArtifacts.test.ts#D-09 replacement guarantee — played-match validation rule (Phase 6, plan 06-02 Task 3)"
        status: pass
    human_judgment: false
  - id: D4
    description: "TeamMetricSchema.percentile (D-04) is bounded [0, 100] at the schema boundary; TeamSeasonArtifactSchema gains robotImageUrl (D-03, URL-shaped) and activeYears (D-05)"
    requirement: "TEAM-03"
    verification:
      - kind: unit
        ref: "packages/harness/pageArtifacts.test.ts#TeamMetricSchema.percentile — D-04 boundary (Phase 6, plan 06-02 Task 3)"
        status: pass
      - kind: unit
        ref: "packages/harness/pageArtifacts.test.ts#TeamSeasonArtifactSchema — robotImageUrl/activeYears (D-03/D-05, Phase 6, plan 06-02 Task 3)"
        status: pass
    human_judgment: false

duration: 15min
completed: 2026-08-25
status: complete
---

# Phase 6 Plan 2: Team-Page Schema and Sigma1 Own-Variance Summary

**Sigma1's predict() now publishes each alliance's own predictive variance, and TeamSeasonArtifactSchema/TeamSeasonMatchSchema/TeamMetricSchema carry every field D-01…D-05 and D-09 need — all optional, no publisher wiring yet.**

## Performance

- **Duration:** ~15 min
- **Tasks:** 3 (3/3 complete)
- **Files modified:** 7

## Accomplishments

- `Prediction` interface gains `redScoreVarianceOwn`/`blueScoreVarianceOwn` (optional numbers), documented as distinct from the existing red+blue-summed `variance` and from `TeamMetric.spread`'s D-09 consistency quantity. Sigma1's `predict()` attaches its two already-computed local variables (posterior + covariance total per alliance) to the returned object instead of discarding them; OPR and EPA leave both fields `undefined`.
- `TeamSeasonMatchSchema` (a `.refine()`-chained `ZodEffects`, rebuilt wholesale since it cannot be `.extend()`-ed) gains `redScoreVarianceOwn`/`blueScoreVarianceOwn` (D-01), `actualRedRp`/`actualBlueRp` (D-02, nullable integer, null contract resolved against `packages/ingest/normalize.ts`), `setNumber`/`matchNumber`/`sortTime` (D-08's Match/Actual column data). `actualWinner`/`actualRedScore`/`actualBlueScore` relaxed to optional (D-09), replaced by a new cross-field `.refine()`: a row must carry all three or none.
- `TeamMetricSchema` gains optional `percentile` (D-04), bounded `[0, 100]`. `TeamSeasonArtifactSchema` gains optional `robotImageUrl` (D-03, URL-shaped) and `activeYears` (D-05).
- `ROUNDING_RULE.percentile = 1` added, matching `colour-and-tiers.md`'s worked precision (p50=39.2). D-01's own-variance fields deliberately reuse `ROUNDING_RULE.variance` unchanged; RP stays unrounded (integral by schema).
- The D-09 replacement guarantee was proven to be a real rule, not a restatement: temporarily removing the new `.refine()` and re-running the suite made exactly 4 of the new test cases fail (each of the three "missing one field" cases, plus the "only actualRedScore" partial-row case), then the refine was restored and the suite re-verified green.

## Task Commits

1. **Task 1: Sigma1 returns each alliance's own predicted-score variance (D-01)** - `00286f10` (feat)
2. **Task 2: Open the published schema for D-01..D-05 and relax it for D-09** - `eaddb4f5` (feat)
3. **Task 3: The replacement validation rule, proven both ways** - `033a1dee` (test)

_No plan-metadata commit — this is a worktree-parallel executor; the orchestrator makes the metadata commit after the wave merges._

## Files Created/Modified

- `packages/core/algorithms/types.ts` - `Prediction.redScoreVarianceOwn`/`blueScoreVarianceOwn`, documented against `variance` and `TeamMetric.spread`
- `packages/core/algorithms/sigma1/index.ts` - `predict()`'s return object now includes the two already-computed own-variance local variables
- `packages/core/algorithms/sigma1/sigma1.test.ts` - regression test proving the returned values equal an independently recomputed posterior+covariance total within 1e-9, and that OPR/EPA leave both fields undefined
- `packages/harness/pageArtifacts.ts` - `TeamSeasonMatchSchema` rebuilt with D-01/D-02/D-08 fields and the D-09 replacement refine; `TeamMetricSchema.percentile`; `TeamSeasonArtifactSchema.robotImageUrl`/`activeYears`
- `packages/harness/pageArtifacts.test.ts` - D-09 replacement-guarantee describe block, own-variance/RP-integrality/null-contract cases, percentile boundary cases, robotImageUrl/activeYears cases
- `packages/harness/rounding.ts` - `ROUNDING_RULE.percentile = 1`
- `packages/harness/rounding.test.ts` - percentile rounding-rule assertions

## Decisions Made

- **RP null contract resolved against `packages/ingest/normalize.ts`, not `rp/constants.ts`.** The plan's `<read_first>` pointed at `rp/constants.ts` to resolve this, but that module has no opinion on `MatchResult.redRpEarned`'s null semantics — it is populated entirely by `normalize.ts`'s `extractRp` at ingest time, before any RP rule module ever sees the match. Read `normalize.ts` directly instead (its own file header states the contract explicitly: "A missing breakdown stays `null`/`hasScoreBreakdown: false` — never coerced to a zero-valued breakdown"). `null` means "not derivable from available data" (no `score_breakdown`, or a breakdown missing the `rp`/`tba_rpEarned` field) — it does NOT mean "RP rules do not apply to this event tier"; TBA reports a real `rp` value (commonly `0`) for every played match regardless of tier, including elimination matches (`ELIMINATION_RP_TOTAL`). This is documented as a doc comment on `actualRedRp`/`actualBlueRp` citing `normalize.ts`, per the plan's acceptance criteria.
- **TEAM-03/TEAM-04/TEAM-05 left `Pending` in `REQUIREMENTS.md`.** This plan's own objective states "No publisher wiring here — `packages/harness/publish.ts` belongs to plan 06-04" and no client UI plan has landed yet either — the fields this plan adds are all optional and unused by any running code path until 06-04 wires the publisher and 06-03+ builds the client. Marking any of the three requirements complete now would be premature; this matches the repo's own established precedent (STATE.md: ALGO-03/ALGO-04 deliberately left incomplete when a plan ships only partial infrastructure toward a multi-plan requirement).
- **RP stays unrounded, no new `ROUNDING_RULE` entry.** The plan's Task 2 action text conditioned this on whether `redRpEarned`/`blueRpEarned` are integral; `MatchResult.redRpEarned: number | null` combined with `normalize.ts`'s `extractRp` (`typeof rp === "number" ? rp : null`, sourced from TBA's own integer `rp` field) confirms integrality, so `actualRedRp`/`actualBlueRp` are typed `z.number().int().nullable().optional()` and asserted integral by the schema itself rather than a rounding rule (Task 3's non-integer-rejection test).

## Deviations from Plan

None — plan executed exactly as written. All three tasks' acceptance criteria were met without needing a Rule 1-4 auto-fix.

## Issues Encountered

- `pnpm test`/`pnpm typecheck` (the plan's literal `<verify>` commands) fail at the `pnpm install` pre-check every invocation on this machine — `better-sqlite3`'s node-gyp rebuild has no Visual Studio toolchain to find (known machine-specific condition, documented in this session's environment notes). Verified functionally instead: `node node_modules/vitest/vitest.mjs run` and `node node_modules/typescript/bin/tsc --noEmit`, invoked directly against the already-populated `node_modules`, both ran clean. Full-workspace run: 1050 passed, 23 skipped, 0 failed, including the `digest`/`fingerprint` baseline tests the plan's Task 1 acceptance criteria specifically call out as proof that Sigma1's return-shape addition moved no predicted number.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- The published schema now structurally supports every field D-01…D-05 and D-09 need; plan 06-04 can wire `publish.ts` to actually populate `redScoreVarianceOwn`/`blueScoreVarianceOwn`, `actualRedRp`/`actualBlueRp`, `setNumber`/`matchNumber`/`sortTime`, `percentile`, `robotImageUrl`, and `activeYears` without any further schema change.
- Client UI plans (06-03+) can build against the widened `TeamSeasonMatchSchema`/`TeamMetricSchema`/`TeamSeasonArtifactSchema` shapes immediately — every new field is optional, so building against them before the republish lands is safe.
- No blockers. The one still-open item from RESEARCH.md's Assumption A5 (the RP null contract) is now resolved and documented in code, not just in planning docs.

---
*Phase: 06-team-pages*
*Completed: 2026-08-25*
