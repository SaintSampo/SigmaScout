---
phase: 04-publish-live-update-pipeline
plan: 02
subsystem: data-pipeline
tags: [zod, rounding, page-schemas, corpus, upcoming-matches, publish-contract]

# Dependency graph
requires:
  - phase: 04-publish-live-update-pipeline
    plan: "04-01"
    provides: "packages/harness/pageArtifacts.ts (artifactKey, EventArtifactSchema, PAGE_ARTIFACT_SCHEMA_VERSION),
      packages/harness/r2Client.ts, packages/harness/publish.ts (buildEventArtifact), and
      packages/core/algorithms/leakProof.ts (OUTCOME_KEYS, toLeakProofUpcoming) — this plan extends the first
      and reads the second without modifying either"
provides:
  - "packages/harness/rounding.ts: roundTo/roundMetric/roundProbability/roundPmf and the ROUNDING_RULE table
    (D-06) — the executable, tested rounding rule confined to the publish path"
  - "packages/harness/pageArtifacts.ts: all five page schemas (TeamsArtifactSchema, TeamSeasonArtifactSchema,
    EventsArtifactSchema, EventArtifactSchema, CompareArtifactSchema) — the contract Phases 5-8 fetch against"
  - "packages/corpus/db.ts: selectScheduledMatches — the D-08 not-yet-played match reader with no outcome
    columns selected at all"
affects: [04-03-multi-page-multi-algorithm-publish, 04-04-teams-events-compare-publish, phase-05-teams-events-ui,
  phase-06-team-page, phase-07-event-page, phase-08-compare-page-and-simulation]

# Actuals (#2632)
actuals:
  tokens: 12959
  tasks: 3
  commits: 5

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Rounding lives in exactly one module (rounding.ts), imported only by the publish path — never by
      score.ts, predictions.ts, or promote.ts's computePredictionStreamDigest — proven each run by
      `git diff --exit-code` over those three files plus digest.test.ts staying green"
    - "roundTo shifts the decimal point via exponential-notation string reparsing
      (Number(`${magnitude}e${decimals}`)) rather than plain multiplication, to avoid the classic IEEE-754
      1.005*100=100.49999999999999 misrounding that a naive Math.round(x*scale)/scale implementation hits"
    - "Every published page schema shares one factored preamble (PagePreambleSchema /
      AlgorithmScopedPreambleSchema) so schemaVersion/generation/computedAt cannot drift between the five pages"
    - "A not-yet-played match's outcome-blindness is structural at the SQL level (selectScheduledMatches never
      selects winner/scores/RP/breakdown columns), the same guarantee toLeakProofUpcoming's Proxy enforces at
      the object level for played matches read early — two different mechanisms proving the same D-08 property"

key-files:
  created:
    - packages/harness/rounding.ts
    - packages/harness/rounding.test.ts
    - packages/harness/pageArtifacts.test.ts
  modified:
    - packages/harness/pageArtifacts.ts
    - packages/corpus/db.ts
    - packages/corpus/db.test.ts

key-decisions:
  - "roundTo implements half-away-from-zero via exponential-notation string reparsing, not
    Math.round(magnitude * 10**decimals) / 10**decimals — the plan's own required test case
    (roundTo(1.005, 2) === 1.01) fails under plain multiplication because 1.005's nearest IEEE-754 double is
    ~1.00499999999999989, so 1.005*100 evaluates to ~100.49999999999999 and rounds down. Not called out in the
    plan's <action> text; discovered by running the plan's own specified test, fixed inline (Rule 1)."
  - "EventArtifactSchema's new teams field (D-07 standings-style list) is optional, not required — plan 04-01's
    already-shipped buildEventArtifact never sets it, and publish.ts is outside this plan's files_modified.
    Making it required would break publish.tracer.test.ts's existing fixture and this plan's own pnpm
    test/typecheck acceptance criteria. Filled by plan 04-03, which owns publish.ts's multi-page widening."
  - "TeamSeasonArtifactSchema's per-match row is a fresh local Zod object mirroring PredictionRecordSchema's
    field names plus redTeams/blueTeams, not an .extend() of PredictionRecordSchema itself —
    PredictionRecordSchema is a ZodEffects (its two .refine() calls make it non-extendable), so the plan's own
    'field names match the sidecar' requirement is met by reconstruction, not literal reuse. metricHistory
    DOES reuse MetricHistoryRowSchema directly (a plain ZodObject, extendable-compatible), so that field is
    literal reuse where the sidecar's schema shape allows it."
  - "CompareArtifactSchema's algorithms/slices row shapes (CompareAlgorithmSchema, CompareSliceSchema, etc.) are
    local reimplementations of artifact.ts's module-private AlgorithmDescriptorSchema/ScoreSliceSchema, not
    imports — those two are not exported from artifact.ts. Documented in pageArtifacts.ts's own comments as a
    deliberate small reimplementation, mirroring the plan's own MissingVersionSeparatorError/
    splitAlgorithmVersion precedent from plan 04-01."

requirements-completed: []

coverage:
  - id: D1
    description: "D-06's rounding rule exists as code with a stated, tested tie-breaking contract, and is
      provably confined to the publish path"
    requirement: DATA-03
    verification:
      - kind: unit
        ref: "packages/harness/rounding.test.ts (19 tests: half-away-from-zero incl. the 1.005 edge, NaN/Infinity
          throws, roundMetric/roundProbability decimal counts, roundPmf renormalization/tie-break/empty-throw,
          ROUNDING_RULE plain-data assertions)"
        status: pass
      - kind: unit
        ref: "git diff --exit-code over promote.ts/predictions.ts/score.ts (unmodified) plus
          packages/harness/digest.test.ts staying green — the reproducibility gate is untouched"
        status: pass
    human_judgment: false
  - id: D2
    description: "Every page the site will render has exactly one schema-validated file behind it; the D-21
      raw-numbers-only and D-09/D-10 separate-uncertainty-meanings rules are enforced by test"
    requirement: DATA-03
    verification:
      - kind: unit
        ref: "packages/harness/pageArtifacts.test.ts (22 tests: valid-fixture parse per schema, D-04
          generation-required, artifactKey's five key shapes incl. the compare exception, the D-05/D-07 empty
          team-season artifact edge, D-08's upcoming pmf-optional/pmf-present shapes, and a mechanical field-name
          scan against /delta|beats|better|rankChange/i across all five schemas' top-level and row-level fields)"
        status: pass
    human_judgment: false
  - id: D3
    description: "D-08's scheduled-match parameters have a data source that structurally cannot leak an outcome,
      and provably partitions an event's rows with the existing played-match reader"
    requirement: DATA-03
    verification:
      - kind: unit
        ref: "packages/corpus/db.test.ts's selectScheduledMatches describe block (5 tests): partition property
          against selectMatchesChronological, OUTCOME_KEYS-driven leak assertion (not a copied literal), the
          identical five-key total order, and the two empty-array edges (no unplayed matches / nonexistent event)"
        status: pass
    human_judgment: false

# Metrics
duration: 15min
completed: 2026-08-22
status: complete
---

# Phase 4 Plan 2: Publish Contract Schemas, Rounding Rule & Scheduled-Match Reader Summary

**All five published page schemas (D-01/D-02/D-04), D-06's tested half-away-from-zero rounding rule confined to the publish path, and the D-08 corpus reader that returns not-yet-played matches with zero outcome columns selected.**

## Performance

- **Duration:** ~15 min
- **Tasks:** 3 (all executed, all TDD RED-then-GREEN)
- **Files modified:** 6 (3 created, 3 modified)

## Accomplishments

- **D-06's rounding rule, executable and tested** (`packages/harness/rounding.ts`): `roundTo` implements
  half-away-from-zero symmetric rounding via exponential-notation string reparsing rather than plain
  multiplication — required to make the plan's own `roundTo(-1.005, 2) === -1.01` test pass at all, since
  IEEE-754's nearest double for `1.005` is `~1.00499999999999989` and a naive
  `Math.round(x * 10**d) / 10**d` silently rounds the wrong way. `roundMetric`/`roundProbability`/`roundPmf`
  apply the per-field-class decimal counts from the plan's table (2/4/5), and `roundPmf` renormalizes with the
  documented largest-entry/lowest-index-tie-break residual so a rounded pmf still satisfies
  `predictions.ts`'s 1e-9 sum tolerance. `ROUNDING_RULE` is exported as plain data. Confirmed confined to the
  publish path: `git diff --exit-code` over `promote.ts`/`predictions.ts`/`score.ts` is clean and
  `digest.test.ts` stays green.
- **All five published page schemas** (`packages/harness/pageArtifacts.ts`, widened from plan 04-01's one):
  `TeamsArtifactSchema` (year-wide teams table), `TeamSeasonArtifactSchema` (D-07's everything-the-team-page-
  needs file, including a reused `MetricHistoryRowSchema` for the metric-history series), `EventsArtifactSchema`
  (events list with `week`/`teamCount`/`matchCount`/`playedMatchCount`), `EventArtifactSchema` (widened:
  `upcoming` now carries D-08's real predicted-parameters shape instead of always being empty; `teams` added for
  the standings-style table), and `CompareArtifactSchema` (the documented D-02 exception — no
  `algorithmId`/`algorithmVersion`, carries `algorithms[]` + per-algorithm raw `ScoreSlice` figures). A shared
  `PagePreambleSchema`/`AlgorithmScopedPreambleSchema` factors D-04's `generation`/`computedAt` stamp so it
  cannot drift between pages. The raw-numbers-only (D-21) and separate-`±`-meanings (D-09/D-10) rules are
  enforced by a mechanical field-name scan test, not left to convention.
- **`selectScheduledMatches`** (`packages/corpus/db.ts`): the D-08 not-yet-played match reader. Mirrors
  `selectMatchesChronological`'s identical `ORDER BY` so an event's played and scheduled halves read in one
  consistent total order, and selects only the seven columns an `UpcomingMatch` needs — `winner`, both scores,
  both RP fields, and both breakdown fields are never in the SELECT list at all, so a returned object cannot
  leak an outcome even by accident. Verified against the exported `OUTCOME_KEYS` set (not a hand-copied list)
  and proven to exactly partition an event's rows with `selectMatchesChronological`.

## Task Commits

1. **Task 1 RED — failing rounding tests** - `5973bf71` (test)
2. **Task 1 GREEN — D-06 rounding rule implementation** - `11c872a2` (feat)
3. **Task 2 — five page schemas + tests** - `9f994cef` (feat)
4. **Task 3 RED — failing selectScheduledMatches tests** - `c0936557` (test)
5. **Task 3 GREEN — selectScheduledMatches implementation** - `c56a61da` (feat)

## Files Created/Modified

- `packages/harness/rounding.ts` - `roundTo`, `roundMetric`, `roundProbability`, `roundPmf`, `ROUNDING_RULE`,
  `NonFiniteRoundError`
- `packages/harness/rounding.test.ts` - 19 tests covering every listed behaviour
- `packages/harness/pageArtifacts.ts` - widened with `TeamsArtifactSchema`, `TeamSeasonArtifactSchema`,
  `EventsArtifactSchema`, `CompareArtifactSchema`; `EventArtifactSchema` widened (`upcoming` real shape, `teams`
  added)
- `packages/harness/pageArtifacts.test.ts` - 22 tests covering the full acceptance-criteria list
- `packages/corpus/db.ts` - `selectScheduledMatches`, `ScheduledMatchQueryOptions`
- `packages/corpus/db.test.ts` - 5 new tests in a `selectScheduledMatches` describe block

## Decisions Made

- `roundTo`'s half-away-from-zero implementation uses exponential-notation string reparsing
  (`Number(`${magnitude}e${decimals}`)`) instead of plain scale-multiply, discovered as a Rule 1 bug fix when
  the plan's own specified `roundTo(1.005, 2)` test case failed under the straightforward implementation. See
  frontmatter `key-decisions` for the full mechanism.
- `EventArtifactSchema.teams` shipped optional (not required) to avoid forcing an out-of-scope rewrite of plan
  04-01's `buildEventArtifact`/`publish.tracer.test.ts` — those live in `publish.ts`, not in this plan's
  `files_modified`, and plan 04-03 owns populating this field.
- `TeamSeasonArtifactSchema`'s match-row schema is a local reconstruction of `PredictionRecordSchema`'s field
  names (that schema is a non-extendable `ZodEffects`), while `metricHistory` reuses `MetricHistoryRowSchema`
  directly since that one IS a plain, extend-compatible `ZodObject`.
- `CompareArtifactSchema`'s algorithm/slice row shapes are local reimplementations of `artifact.ts`'s
  module-private `AlgorithmDescriptorSchema`/`ScoreSliceSchema` (neither is exported), mirroring the
  `MissingVersionSeparatorError` precedent plan 04-01 already established for the same not-exported situation.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `roundTo`'s naive scale-multiply implementation misrounds `1.005`/`−1.005`**
- **Found during:** Task 1, running the plan's own specified test (`roundTo(1.005, 2)` must equal `1.01`)
- **Issue:** `Math.round(Math.abs(value) * 10**decimals) / 10**decimals` computed `Math.round(100.49999999999999) / 100 = 1`, not `1.01`, because IEEE-754's nearest double for `1.005` is slightly below it.
- **Fix:** Switched to shifting the decimal point via `Number(`${magnitude}e${decimals}`)` (exponential-notation string reparsing), which reparses the value's shortest round-trippable decimal string as one literal instead of computing an intermediate float product. Applied the same fix to `roundPmf`'s residual computation for consistency.
- **Files modified:** `packages/harness/rounding.ts`
- **Commit:** `11c872a2`

None of the plan's other tasks required a deviation — Task 2 and Task 3 executed as written, including all the read-first context they specified.

## Known Stubs

None. `EventArtifactSchema.teams` is optional rather than populated, but this is an explicitly planned staging
point (see Decisions Made) — plan 04-03 fills it as part of widening `publish.ts`, matching the exact precedent
plan 04-01 set for `upcoming` (schema existed one plan before the data flowed).

## Issues Encountered

None beyond the roundTo float-precision bug documented above (auto-fixed under Rule 1).

## User Setup Required

None. This plan touched no infrastructure, no credentials, and no external services — pure schema/rounding/
corpus-reader work against the local temp-corpus test fixtures, per this plan's own `<secrets_handling>` note
that it should not need credentials at all.

## Next Phase Readiness

- The full five-schema publish contract exists and is reviewable — plan 04-03 (multi-page multi-algorithm
  publish) and plan 04-04 (teams/events/compare publish) can widen `publish.ts` against a stable, tested target
  rather than inventing shapes as they go.
- D-06's rounding rule is ready to be called from wherever plan 04-03/04-04 assembles a candidate artifact,
  before its `.parse()` call.
- `selectScheduledMatches` unblocks D-08's upcoming-match population — plan 04-03/04-04 can now read an event's
  not-yet-played matches, run them through an algorithm's `predict()`, and populate `EventArtifactSchema.upcoming`
  with real (rounded) parameters instead of an empty array.
- `EventArtifactSchema.teams` and the `TeamsArtifactSchema`/`TeamSeasonArtifactSchema`/`EventsArtifactSchema`
  publish logic remain unbuilt — that is plan 04-03/04-04's explicit scope, not a gap in this plan.

---
*Phase: 04-publish-live-update-pipeline*
*Completed: 2026-08-22*

## Self-Check: PASSED

All three created files confirmed present on disk (`packages/harness/rounding.ts`,
`packages/harness/rounding.test.ts`, `packages/harness/pageArtifacts.test.ts`). All five task commits
(`5973bf71`, `11c872a2`, `9f994cef`, `c0936557`, `c56a61da`) confirmed present in `git log --oneline --all`.
