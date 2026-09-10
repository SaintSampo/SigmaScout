---
phase: quick-260908-wpo
plan: 01
subsystem: publish-pipeline
tags: [team-artifact, seasonStats, official-play-scoping, schema, publisher]
dependency-graph:
  requires:
    - packages/harness/publish.ts (lastOfficialMetricsByTeam, officialMetricsByTeamWithPercentiles, quick task 260904-586/260908-615)
    - packages/harness/percentiles.ts (withPercentiles, TeamMetricsWithPercentile)
    - packages/harness/pageArtifacts.ts (TeamSeasonArtifactSchema, RecordAndMetricsSchema)
  provides:
    - TeamSeasonArtifactSchema.seasonStats.metricsBasis (packages/harness/pageArtifacts.ts)
    - seasonStatsMetricsForTeam() (packages/harness/publish.ts)
  affects:
    - packages/harness/publish.ts's team-artifact call site (~2784, buildTeamSeasonArtifact)
    - every published v1/team/{teamKey}/{year}/{algorithm}.json artifact (pending Task 3 republish)
tech-stack:
  added: []
  patterns:
    - "Schema field optional-at-parse / mandatory-on-write-side split, for a back-compat-safe field addition ahead of a full republish (same shape as the EPA-comparison artifact's basis field, quick task 260908-n5o)"
key-files:
  created: []
  modified:
    - packages/harness/pageArtifacts.ts
    - packages/harness/pageArtifacts.test.ts
    - packages/harness/publish.ts
    - packages/harness/publish.test.ts
    - packages/harness/eventRank.tracer.test.ts
    - packages/harness/payloadBudget.test.ts
decisions:
  - "metricsBasis extended at seasonStats's use site (RecordAndMetricsSchema.extend(...)) rather than added to the shared RecordAndMetricsSchema itself — that schema has exactly one consumer (TeamSeasonArtifactSchema.seasonStats) and stays generic per the plan's placement discretion."
  - "seasonStatsMetricsForTeam checks BOTH presence and emptiness of the official record before selecting it, rather than presence alone — a presence-only check would depend on lastOfficialMetricsByTeam's omission-of-offseason-only-teams invariant holding at every future call site forever; the emptiness check makes the fallback structural instead."
  - "The real production call site in publish.ts got a literal 'last-official-match' placeholder in Task 1's commit (schema/threading only, no selection logic yet), replaced by the real seasonStatsMetricsForTeam() call in Task 2's commit — kept as two atomic, independently-compiling commits matching the plan's two-task split."
actuals:
  tokens: 58000
  tasks: 2
  commits: 2
status: complete
---

# Phase quick-260908-wpo Plan 01: Publish seasonStats.metrics as the last-official-match snapshot (Tasks 1-2) Summary

Closed the split between `seasonStats.record`/`matchCount`/`eventCount` (official-play-only since
quick task 260908-615) and `seasonStats.metrics` (previously season-final, offseason/preseason
inclusive). The published team artifact's `seasonStats` now reads one consistent population, and
every artifact names which basis its metrics carry via the new `metricsBasis` field. **Tasks 3 and 4
(full republish and live parity verification) were deliberately NOT run — see "Tasks 3-4" below.**

## What Was Built

**Task 1 — schema field and threading.** `TeamSeasonArtifactSchema.seasonStats` in
`packages/harness/pageArtifacts.ts` now extends `RecordAndMetricsSchema` with an optional
`metricsBasis: z.enum(["last-official-match", "season-final"])`, doc-commented with both values'
meaning and the pre-260908-wpo back-compat reading of an absent field. Optional at parse (so a
CDN-cached pre-republish artifact keeps parsing during the republish window) but required on
`BuildTeamSeasonArtifactParams.seasonStats` — every caller of `buildTeamSeasonArtifact` must now
state a basis, and the value is passed through to the candidate object unmodified (no rounding, no
transform). Four new schema tests cover both enum values, the absent-field back-compat case, and
rejection of a third string value. The real production call site (publish.ts ~2784) got a literal
`"last-official-match"` placeholder pending Task 2's real selection logic — this made Task 1 an
independently-compiling, independently-testable commit.

**Task 2 — the actual official-with-fallback selection.** Added `seasonStatsMetricsForTeam(teamKey,
officialWithPercentiles, seasonFinalWithPercentiles)`, exported next to `lastOfficialMetricsByTeam`
in `publish.ts`. It takes the two already-built percentile-widened records
(`officialMetricsByTeamWithPercentiles`, `metricsByTeamWithPercentiles`) and introduces no new
officialness derivation. Selection rule: the official entry wins (tagged `"last-official-match"`)
when present AND non-empty; otherwise falls back to the season-final entry (tagged `"season-final"`).
Checking emptiness (not just presence) is the load-bearing part — it structurally cannot publish an
empty metrics object for an offseason-only team even if `lastOfficialMetricsByTeam`'s
omission-of-such-teams invariant ever changed at some other call site. Wired at the team-artifact
call site, replacing the bare `metricsByTeamWithPercentiles[teamKey] ?? {}` (and Task 1's placeholder)
with the helper's `metrics`/`metricsBasis`. `withPublishedTiers` was deliberately NOT applied here —
the team artifact never applied tiers and this task doesn't start.

Corrected the now-false comment above `officialMetricsByTeamWithPercentiles` that asserted
`seasonStats`/`metricHistory` "stay season-final, exactly as before" — rewritten to state that
`seasonStats.metrics` now reads the official-with-fallback basis via `seasonStatsMetricsForTeam`,
while `metricHistory` and `sortedPools` genuinely do stay season-final, unchanged.

Four new direct unit tests on the helper (official wins; official absent falls back; **official
present-but-empty ALSO falls back** — the named trap; neither record has an entry — never throws)
plus three `publishSeasons` end-to-end tests: a team with one official and one offseason match
publishes `seasonStats.metrics` equal to the Teams-list row's value, tagged `last-official-match`,
while `metricHistory` still carries the offseason row; an offseason-only team publishes **non-empty**
`seasonStats.metrics` tagged `season-final` (asserting the values, not merely the basis string — a
basis-only assertion would pass on a blanked team); an official-only team's value agrees exactly with
its own season-final `metricHistory` (the frc254 no-regression case).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - blocking] Two test files outside the plan's stated files_modified list needed fixing**
- **Found during:** Task 1's `npx tsc --noEmit` verify, after making `seasonStats.metricsBasis`
  required on `BuildTeamSeasonArtifactParams`
- **Issue:** `packages/harness/eventRank.tracer.test.ts` and `packages/harness/payloadBudget.test.ts`
  each call `buildTeamSeasonArtifact` with a `seasonStats` literal that no longer satisfied the
  (now-required) type — a genuine compile-blocking issue, not a plan gap.
- **Fix:** Added `metricsBasis: "last-official-match"` to each call site's `seasonStats` object.
  Neither test asserts anything about `metricsBasis`, so the value is inert for their purposes.
- **Files modified:** `packages/harness/eventRank.tracer.test.ts`, `packages/harness/payloadBudget.test.ts`
- **Commit:** `0afefc78`

**2. [Rule 3 - blocking] A dozen additional `buildTeamSeasonArtifact` call sites inside `publish.test.ts` needed the same fix**
- **Found during:** the same `npx tsc --noEmit` pass
- **Issue:** every pre-existing `seasonStats: { record, metrics }` literal in `publish.test.ts` broke
  once `metricsBasis` became required.
- **Fix:** added `metricsBasis: "last-official-match"` (or `as const` where the surrounding object
  was widened by `const` inference without a contextual type, e.g. the `swingFactor` test's `base`
  object) to every affected literal. None of these tests assert anything about `metricsBasis`.
- **Files modified:** `packages/harness/publish.test.ts`
- **Commit:** `0afefc78`

No other deviations. Plan executed as written otherwise.

## Tasks 3-4 — Deliberately Not Run

Per the plan's operating rule 6 and this executor's explicit instructions, **Tasks 3 and 4 are
ORCHESTRATOR-RUN and were not attempted in this session**:

- **Task 3** (`checkpoint:human-verify`, gate `blocking`) — the full `pnpm publish:seasons` republish
  (~75,000 objects), `pnpm manifest:algorithms`, `pnpm verify:subset`, and transcribing
  `docs/publish-budget.md`'s Latest-run paragraph and json block by hand.
- **Task 4** (`checkpoint:human-verify`, gate `blocking`) — live parity verification against
  `data.sigmascout.org` for frc7769/frc88/frc2056/frc254, the offseason-only-team regression check,
  a browser load of a team page with offseason play, and closing
  `.planning/todos/pending/season-final-metric-is-not-what-any-page-shows.md`.

Both require network access this executor's sandbox denies. As of this SUMMARY, `data.sigmascout.org`
still serves pre-260908-wpo artifacts — `seasonStats.metrics` there is still season-final and carries
no `metricsBasis` field, and the todo's repro still prints two different numbers. Nothing about the
fix is observable live until the orchestrator runs Task 3's republish followed by Task 4's
verification, from the main context.

## Known Stubs

None. This task changes which already-computed value flows into an existing field; no new UI, no new
data source, no placeholder values.

## Self-Check: PASSED

- All 6 modified files confirmed present on disk: `packages/harness/pageArtifacts.ts`,
  `packages/harness/pageArtifacts.test.ts`, `packages/harness/publish.ts`,
  `packages/harness/publish.test.ts`, `packages/harness/eventRank.tracer.test.ts`,
  `packages/harness/payloadBudget.test.ts`.
- Both task commit hashes (`0afefc78`, `4fc2225d`) confirmed present in `git log --oneline --all`.
- Full root `npx vitest run`: 218 test files passed, 4069 tests passed, 4 skipped, 0 failed (up from
  the pre-task baseline of 218 files / 4058 tests — the delta is 11 new tests: 4 schema tests, 4
  direct unit tests on `seasonStatsMetricsForTeam`, 3 `publishSeasons` end-to-end tests).
- Root `npx tsc --noEmit`: clean except the two confirmed pre-existing, unrelated errors named in the
  plan's operating rule 5 (`packages/harness/tune.test.ts(1069)`,
  `packages/harness/stateSnapshot.test.ts(1008,1027)`) — not fixed, out of scope, belong to another
  concurrent session.
- `npx tsc --noEmit -p apps/web/tsconfig.json`: clean.
- `grep -qF "sections stay season-final, exactly as before" packages/harness/publish.ts`: no match —
  the superseded comment sentence is gone.
- `git status --short` after each commit showed no foreign files staged or absorbed.
