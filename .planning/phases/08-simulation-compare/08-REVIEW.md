---
phase: 08-simulation-compare
reviewed: 2026-09-01T02:43:41Z
depth: standard
files_reviewed: 86
files_reviewed_list:
  - apps/web/e2e/compare-narrow-legibility.spec.ts
  - apps/web/e2e/event-scroll-regions.spec.ts
  - apps/web/e2e/simulation-run.spec.ts
  - apps/web/e2e/simulation-tab.spec.ts
  - apps/web/e2e/support/scrollRegions.ts
  - apps/web/e2e/support/simulation.ts
  - apps/web/playwright.config.ts
  - apps/web/src/components/StateViews.test.tsx
  - apps/web/src/components/StateViews.tsx
  - apps/web/src/components/compare/AccuracyTable.test.tsx
  - apps/web/src/components/compare/AccuracyTable.tsx
  - apps/web/src/components/compare/CalibrationChart.test.tsx
  - apps/web/src/components/compare/CalibrationChart.tsx
  - apps/web/src/components/compare/CalibrationSection.test.tsx
  - apps/web/src/components/compare/CalibrationSection.tsx
  - apps/web/src/components/compare/CompLevelSwitcher.test.tsx
  - apps/web/src/components/compare/CompLevelSwitcher.tsx
  - apps/web/src/components/compare/DataCoverageTable.test.tsx
  - apps/web/src/components/compare/DataCoverageTable.tsx
  - apps/web/src/components/compare/MethodologyNote.test.tsx
  - apps/web/src/components/compare/MethodologyNote.tsx
  - apps/web/src/components/compare/calibrationSeries.test.ts
  - apps/web/src/components/compare/calibrationSeries.ts
  - apps/web/src/components/compare/comparePalette.test.ts
  - apps/web/src/components/compare/coverageRows.test.ts
  - apps/web/src/components/compare/coverageRows.ts
  - apps/web/src/components/event/RankDistributionTable.test.tsx
  - apps/web/src/components/event/RankDistributionTable.tsx
  - apps/web/src/components/event/RunControl.test.tsx
  - apps/web/src/components/event/RunControl.tsx
  - apps/web/src/components/event/SimulationTab.failure.test.tsx
  - apps/web/src/components/event/SimulationTab.test.tsx
  - apps/web/src/components/event/SimulationTab.tsx
  - apps/web/src/components/event/StartMatchPicker.test.tsx
  - apps/web/src/components/event/StartMatchPicker.tsx
  - apps/web/src/components/event/rankRows.test.ts
  - apps/web/src/components/event/rankRows.ts
  - apps/web/src/components/event/simulationTestFixtures.ts
  - apps/web/src/components/event/useSimulationRun.test.ts
  - apps/web/src/components/event/useSimulationRun.ts
  - apps/web/src/lib/api/compare.test.ts
  - apps/web/src/lib/api/compare.ts
  - apps/web/src/lib/compareTie.test.ts
  - apps/web/src/lib/compareTie.ts
  - apps/web/src/lib/rewindGap.ts
  - apps/web/src/lib/searchParams.test.ts
  - apps/web/src/lib/searchParams.ts
  - apps/web/src/lib/simAxis.test.ts
  - apps/web/src/lib/simAxis.ts
  - apps/web/src/lib/simQuantile.test.ts
  - apps/web/src/lib/simQuantile.ts
  - apps/web/src/lib/simulationInputs.test.ts
  - apps/web/src/lib/simulationInputs.ts
  - apps/web/src/routes/__fixtures__/compare-2022.json
  - apps/web/src/routes/__fixtures__/compare-2023.json
  - apps/web/src/routes/__fixtures__/compare-2024.json
  - apps/web/src/routes/__fixtures__/compare-2025.json
  - apps/web/src/routes/__fixtures__/compare-2026.json
  - apps/web/src/routes/compare.test.tsx
  - apps/web/src/routes/compare.tsx
  - apps/web/src/routes/event.$eventKey.test.tsx
  - apps/web/src/routes/event.$eventKey.tsx
  - apps/web/src/styles/theme.css
  - apps/web/src/test/mockWorker.test.ts
  - apps/web/src/test/mockWorker.ts
  - apps/web/src/workers/createSimulationWorker.ts
  - apps/web/src/workers/simulation.worker.ts
  - apps/web/src/workers/simulationProtocol.test.ts
  - apps/web/src/workers/simulationProtocol.ts
  - docs/models/rewind-overconfidence-gap.md
  - docs/publish-budget.md
  - docs/ui/rank-distribution-mock.md
  - package.json
  - packages/core/algorithms/simulation/rankSimulation.test.ts
  - packages/core/algorithms/simulation/rankSimulation.ts
  - packages/harness/browserSafeSchemas.test.ts
  - packages/harness/pageArtifacts.test.ts
  - packages/harness/pageArtifacts.ts
  - packages/harness/payloadBudget.test.ts
  - packages/harness/publish.test.ts
  - packages/harness/publish.ts
  - packages/harness/rounding.ts
  - scripts/measureRewindGap.test.ts
  - scripts/measureRewindGap.ts
  - scripts/mockRankDistribution.ts
  - scripts/verifySubsetPublish.ts
findings:
  critical: 0
  warning: 2
  info: 2
  total: 4
status: resolved
---

# Phase 8: Code Review Report

**Reviewed:** 2026-09-01T02:43:41Z
**Depth:** standard
**Files Reviewed:** 86
**Status:** issues_found

## Summary

Reviewed the simulation core (`rankSimulation.ts`), the browser assembly layer
(`simulationInputs.ts`, `simQuantile.ts`, `simAxis.ts`, `rankRows.ts`), the Web
Worker lifecycle (`useSimulationRun.ts`, `createSimulationWorker.ts`,
`simulation.worker.ts`, `simulationProtocol.ts`), the publisher/schema changes
that add `redRpPmf`/`blueRpPmf`/`actualRedRp`/`actualBlueRp` to `EventMatchSchema`
(`pageArtifacts.ts`, `publish.ts`, `rounding.ts`), the Compare page and its
supporting modules (`compareTie.ts`, `calibrationSeries.ts`, `coverageRows.ts`,
`AccuracyTable.tsx`, `CalibrationChart.tsx`, `CalibrationSection.tsx`,
`DataCoverageTable.tsx`, `MethodologyNote.tsx`), and the credential-free
scripts (`measureRewindGap.ts`, `verifySubsetPublish.ts`,
`mockRankDistribution.ts`).

This is an unusually well-documented and self-testing codebase — nearly every
non-trivial line carries a doc comment naming the exact edge case it defends
against, and several of those doc comments cite the specific defect class
(e.g. season-dependent pmf length, RP average-vs-total unit confusion,
null-vs-zero RP coercion) called out in this review's briefing. Secrets
handling is clean: the three new scripts (`measureRewindGap.ts`,
`verifySubsetPublish.ts`, `mockRankDistribution.ts`) are correctly wired
without `--env-file` in `package.json`, none imports `r2Client.ts`, and none
reads `.env`. No hardcoded secrets, `eval`, `dangerouslySetInnerHTML`, or
empty catch blocks were found in the diff's production code.

The one substantive finding (WR-01) is a fragile type-narrowing discriminant
in `simulationInputs.ts` that keys off an *optional* schema field
(`"actualRedRp" in row`) to distinguish a played match row from an upcoming
one, when a non-optional field (`actualWinner`) — and the established pattern
in `eventMatchAxis.ts`, which this exact module imports from — already
exists for that purpose. In the current system this is not reachable in
practice (both fields are always written together, atomically, in the same
publish run), but the discriminant's soundness rests on that coupling being
preserved forever with no test or type enforcing it, and a failure mode would
silently reproduce exactly the "coerce a missing baseline to 0 with no
caveat" outcome D-12 explicitly rejected. The remaining findings are minor
robustness/quality notes.

## Warnings

### WR-01: Fragile discriminant for "is this a played row" keys off an optional field, not a guaranteed-present one

**Status:** resolved — `isPlayedRawRow` now discriminates on `actualWinner` (required on every played row in every artifact era); a played row with absent `actualRedRp` (pre-republish) counts as an appearance with unknowable RP credit (known-incomplete), never a silent 0 (2026-08-31).

**File:** `apps/web/src/lib/simulationInputs.ts:136-139`
**Issue:**

```ts
function isPlayedRawRow(row: RawQualRow): row is EventArtifact["matches"][number] {
  return "actualRedRp" in row;
}
```

`isPlayedRawRow` distinguishes a played (`matches[]`) row from an upcoming
(`upcoming[]`) row by checking for the presence of `actualRedRp`. But
`actualRedRp` is declared `.nullable().optional()` on `EventMatchSchema`
(`pageArtifacts.ts`), and per that field's own doc comment, the key being
entirely **absent** is a real, representable published state meaning "this
artifact predates the field." That means `isPlayedRawRow` can return `false`
for a row that genuinely is played, whenever the fetched artifact predates
the D-03/D-12 republish (a stale CDN-cached copy, or any future rollback/
partial-republish scenario).

When that happens, `buildSimulationInputs`'s prefix-accumulation loop
(`simulationInputs.ts:241-248`) silently `continue`s past the row instead of
counting the team's appearance:

```ts
const raw = rawIndex.get(row.matchKey);
if (raw === undefined || !isPlayedRawRow(raw)) continue;
accumulateAlliance(row.redTeams, raw.actualRedRp);
accumulateAlliance(row.blueTeams, raw.actualBlueRp);
```

A team whose *only* prefix appearance falls on such a row ends up with
`appearances === 0`, and downstream (`simulationInputs.ts:266-271`) that team
is classified `"no-played-matches"` with `earnedRpSum: 0, matchesPlayed: 0` —
**not** flagged via `incompleteBaselineTeamKeys` (that set is populated only
when an explicit `actualRp === null` is *encountered*, which never happens
here because the row is skipped before `accumulateAlliance` runs at all).
This is silently indistinguishable, both in code and in the UI's own
disclosure text (`StartMatchPicker.tsx`'s `simulationScopeText`), from a team
that genuinely has not played — precisely the outcome D-12's own decision
record calls out and rejects for the *known-derivable-but-missing* case:
"treating a missing baseline as 0 with a caveat — it understates a team that
has genuinely played matches... is the opposite of this site's premise." Here
it ships without even the caveat.

In the *current* system this is not exploitable: `publish.ts` writes
`redRpPmf` and `actualRedRp` in the same object literal, unconditionally, on
every `matches[]` row in one publish run (`publish.ts:548-566`), so the two
fields are always co-present or co-absent for any given artifact. Because
`redRpPmf`'s absence already fails the upstream `hasSimulatableRankInputs`
gate in `SimulationTab.tsx` (which would show the "isn't available" state
before `buildSimulationInputs` is ever called on a genuinely pre-republish
artifact), the specific failure path described above requires an artifact
where *pmf is present but actualRedRp is absent* — a state the current
publisher code cannot produce. But nothing enforces that coupling: it is an
implicit invariant between two independently-optional Zod fields, with no
test exercising "a played row with `redRpPmf` present and `actualRedRp`
entirely absent." `simulationInputs.test.ts` only exercises `actualRedRp:
null` (line 267), never `actualRedRp` omitted with the row otherwise
qualifying as simulatable.

Contrast with the codebase's own established, correct pattern one file over:
`eventMatchAxis.ts`'s `toRow()` sets `played` structurally, from which array
(`matches` vs `upcoming`) the row was read — never from an optional field's
presence — which is exactly why `isRewindStart`/`buildQualRows` (also in
`simulationInputs.ts`) are sound. `isPlayedRawRow` is the one place in this
module that deviates from that pattern.

**Fix:** Key the discriminant off a field that is unconditionally present on
every `matches[]` row and never present on `upcoming[]` — `actualWinner` (or
`actualRedScore`/`actualBlueScore`), all three of which are required,
non-optional fields on `EventMatchSchema` and absent from
`EventUpcomingMatchSchema`:

```ts
function isPlayedRawRow(row: RawQualRow): row is EventArtifact["matches"][number] {
  return "actualWinner" in row;
}
```

This makes the function correct regardless of whether `actualRedRp` happens
to be present, removing the implicit dependency on the two fields' publish
ordering ever staying coupled. Consider also adding a
`simulationInputs.test.ts` case with a played row that has `redRpPmf`
present but `actualRedRp` (and `actualBlueRp`) entirely omitted, to lock in
whichever behavior is chosen (either the fixed discriminant above, or an
explicit fallback that flags the team as incomplete rather than silently
zeroing it).

### WR-02: `CalibrationChart`'s point-selection lookup is keyed by a computed float that could theoretically collide

**Status:** resolved — `CalibrationChartCell` now carries its ORIGINAL `point`; the dot renderer reads it off the cell and the float-keyed `buildPointLookup` is deleted (2026-08-31).

**File:** `apps/web/src/components/compare/CalibrationChart.tsx:69-77, 99`
**Issue:** `buildPointLookup` keys a `Map<number, CalibrationPoint>` by
`point.meanPredicted * 100` per algorithm. `buildCalibrationRows`
(`calibrationSeries.ts:179-204`) independently computes the same
`x = point.meanPredicted * 100` for the row's `x` field, and
`CalibrationDot`'s click/hover handler recovers the "original" point via
`pointLookup.get(row.x)` (`CalibrationChart.tsx:99`). If two *different* bins
for the same algorithm/season/compLevel published an identical
`meanPredicted` (published unrounded, so not astronomically unlikely across
enough slices/seasons as the corpus grows — a bin with very few matches all
agreeing exactly, or two bins whose predicted-probability means happen to
coincide), `buildPointLookup`'s `Map.set` silently keeps only the
last-written point for that x, and the dot renderer for the *other*,
overwritten bin would resolve to the wrong point, misreporting predicted %,
observed %, and match count on hover/click for that bin.
**Fix:** Key the lookup by `(algorithmId, binStart)` (or the bin's own array
index) instead of a derived float, which is unique by construction and
matches the actual identity `calibrationSeries.ts`'s `CalibrationPoint`
already carries (`binStart`).

## Info

### IN-01: `resolveWinnerAccuracyLeaders`'s explicit zero-`scoredCount` guard duplicates work `naiveStandardError`/`isNearTie` already do

**Status:** resolved — kept per the finding's own second option: the doc comment now names the deliberate redundancy with `isNearTie`'s non-finite guard so the two paths cannot drift silently (2026-08-31).

**File:** `apps/web/src/lib/compareTie.ts:160-172`
**Issue:** `resolveWinnerAccuracyLeaders` explicitly checks
`leader.scoredCount === 0 || runnerUp.scoredCount === 0` and returns `[]`
before calling `naiveStandardError`. But `naiveStandardError(p, 0)` already
returns `Infinity` or `NaN` (division by zero), and `isNearTie`'s own
non-finite guard (`compareTie.ts:77-80`) already treats any non-finite bound
as a tie, returning the same `[]` result. The explicit guard is redundant
with the mechanism the module's own doc comment describes as the intended
safety net ("`isNearTie`'s non-finite guard is what keeps that simplification
from ever asserting a winner it cannot support"). Not a bug — both paths
converge on the correct, safe answer — but it is two independent
implementations of the same invariant that could silently drift if one is
edited without the other (e.g. a future change loosens the explicit
`scoredCount === 0` check without noticing the non-finite fallback already
covers it, or vice versa).
**Fix:** Either remove the explicit check and rely solely on
`isNearTie`'s non-finite guard (simplifying the function), or keep the
explicit check and add a comment noting it is intentionally redundant with
`isNearTie` for the "count of zero is a fact about the slice worth naming"
reason the doc comment already states — the code currently states that
reason without acknowledging the guard is otherwise redundant.

### IN-02: `mockRankDistribution.ts`'s `totalBarElementCount` field is a duplicate of `visibleBarCount`

**Status:** resolved — `totalBarElementCount` removed; the node-budget sum reads `visibleBarCount` directly (2026-08-31).

**File:** `scripts/mockRankDistribution.ts:214-219`
**Issue:** `measureRow` sets both `visibleBarCount: visibleBarCount(row)` and
`totalBarElementCount: visibleBarCount(row)` — the same function call,
assigned to two differently-named fields with no distinguishing logic between
them. This is a dev-only measurement script (not shipped), so it carries no
runtime risk, but it is dead/duplicated output that could confuse whoever
reads the mock's printed measurements later (e.g. `docs/ui/rank-distribution-mock.md`
citing "total bar element count" as if it were a distinct, larger figure than
"visible bar count" — e.g. a per-row total across all rows, or a total
including invisible bars — when it is actually identical to it).
**Fix:** Either remove `totalBarElementCount` if it adds no information, or
give it its own computation (e.g. a running total across all rows in the
event, if that was the original intent) so the two field names describe two
different numbers.

---

_Reviewed: 2026-09-01T02:43:41Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
