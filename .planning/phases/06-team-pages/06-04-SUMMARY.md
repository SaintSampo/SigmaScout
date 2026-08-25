---
phase: 06-team-pages
plan: 04
subsystem: data-pipeline
tags: [publisher, zod, sigma1, percentile, team-media, activeYears, published-artifact]

# Dependency graph
requires:
  - phase: 06-team-pages
    provides: "06-02's widened TeamSeasonMatchSchema/TeamMetricSchema/TeamSeasonArtifactSchema (all fields optional, unpopulated) and the resolved actualRedRp/actualBlueRp null contract"
  - phase: 06-team-pages
    provides: "06-03's filled team_media corpus table (17,229 team-year rows, 7,364 with a resolved photo) and selectTeamMediaForYear/selectTeamKeysForYear accessors"
provides:
  - "buildTeamSeasonArtifact/publishSeasons populate every field 06-02 opened: redScoreVarianceOwn/blueScoreVarianceOwn (D-01), actualRedRp/actualBlueRp (D-02), setNumber/matchNumber/sortTime, percentile (D-04), robotImageUrl (D-03), activeYears (D-05)"
  - "The eventName defect fixed — team-season event sections publish the real event name (meta?.name ?? eventKey), not the opaque key"
  - "A team's scheduled (not-yet-played) matches merge into the same per-event match list as played matches, sorted by sortTime with the same compLevel/setNumber/matchNumber/matchKey tie-break chain selectScheduledMatches uses"
  - "packages/harness/percentiles.ts — percentileRanks (mid-rank convention) and withPercentiles, the one insertion point for a season's full-pool percentile pass"
  - "A real pnpm publish:seasons --dry-run run across 2022-2026/opr+epa+sigma1 validated every new field at full corpus scale (54,671 objects, exit 0) and projected the team page's new payload ceiling"
affects: [06-05, 06-06, 06-07, 06-08, 06-09]

# Actuals (#2632)
actuals:
  tokens: 12332
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "A module-local prepared-statement helper (selectScheduledMatchTimes) mirrors selectEventMeta's style for a query with no natural home in packages/corpus/db.ts's public surface"
    - "A percentile/rank pass runs once at the single point a per-(algorithm,season) metrics record is assembled, producing a structurally reusable widened record — only one of two possible consumers wires its consumption this phase, deliberately, per a recorded scope boundary"
    - "Mid-rank percentile: (countStrictlyBelow + 0.5*countEqual)/n*100, computed via one sort plus a linear tie-group sweep, not O(n^2)"

key-files:
  created:
    - packages/harness/percentiles.ts
    - packages/harness/percentiles.test.ts
  modified:
    - packages/harness/publish.ts
    - packages/harness/publish.test.ts

key-decisions:
  - "TEAM-02/TEAM-03/TEAM-04/TEAM-05 left incomplete in this plan's own frontmatter reporting (requirements-completed: []) — this plan ships the publisher-side wiring only; no client team page exists yet (that's 06-05+ in this wave/later waves). Matches the repo's established 06-02/ALGO-03/ALGO-04 precedent of not marking a shared multi-plan requirement complete until the plan that makes it user-visible lands."
  - "Percentile is computed once per (algorithm, season) at the existing metricsByTeam reuse point, but only the per-team artifact's seasonStats.metrics consumes the widened result this phase — teams/{year}'s teamsRows deliberately keeps reading the unwidened metricsByTeam, per 06-RESEARCH.md Open Question 2's scope boundary (widening the teams-table artifact's published surface is a later phase's decision)."
  - "Scheduled predictions for the team branch are computed from the SAME scheduledPredictionsByEvent map the event branch's upcoming array already builds (one predict() call per scheduled match, not one per (event, team) pairing) — an efficiency choice made while implementing D-08's per-team merge, not a plan requirement, but consistent with the plan's own 'not one predict() per pairing' framing for the event branch."
  - "roundTeamMetricRecord (shared by every RecordAndMetricsSchema/EventTeamSchema/TeamsTableRowSchema consumer) now passes an already-rounded percentile field through unchanged instead of silently reconstructing {value, spread} only — required for D-04's percentile to survive the publish-boundary rounding pass on its way into seasonStats.metrics; every other existing call site is unaffected since a plain TeamMetric has no percentile field to drop in the first place."

patterns-established:
  - "A cross-season pre-pass (activeYearsByTeam) runs once before the per-season loop, inverting a per-season corpus query into a team-keyed map — the shape any future 'known across every requested season' field should follow, rather than recomputing inside the season loop."

requirements-completed: []

coverage:
  - id: D1
    description: "eventName defect fixed: buildTeamSeasonArtifact's per-team loop publishes meta?.name ?? eventKey (the real event name when the corpus has one, the key as a documented fallback for an un-refreshed corpus) instead of the event key unconditionally"
    requirement: "TEAM-04"
    verification:
      - kind: unit
        ref: "packages/harness/publish.test.ts#publishSeasons — Phase 6 team-artifact wiring against a real corpus (plan 06-04 Task 1) > fixes the eventName defect (real name published, null-column corpus degrades to the event key) and keeps an event with only a scheduled match as its own section, not dropped"
        status: pass
    human_judgment: false
  - id: D2
    description: "redScoreVarianceOwn/blueScoreVarianceOwn (D-01) and actualRedRp/actualBlueRp (D-02) round-trip from Prediction/MatchResult through buildTeamSeasonArtifact, rounded/typed per their documented contracts (variance at ROUNDING_RULE.variance, RP never coerced null->0)"
    requirement: "TEAM-05"
    verification:
      - kind: unit
        ref: "packages/harness/publish.test.ts#buildTeamSeasonArtifact — Phase 6 D-01/D-02/D-08/D-09 per-match fields (plan 06-04 Task 1) (4 cases: own-variance round trip + OPR-undefined, integer RP round trip, null RP round trip)"
        status: pass
    human_judgment: false
  - id: D3
    description: "A scheduled (not-yet-played) match publishes predicted fields with every actual field undefined and parses; an event a team is only scheduled to attend produces its own section instead of being dropped; a team's matches within an event are ordered by sortTime with the compLevel/setNumber/matchNumber/matchKey tie-break chain selectScheduledMatches uses, independent of insertion order"
    requirement: "TEAM-04"
    verification:
      - kind: unit
        ref: "packages/harness/publish.test.ts#buildTeamSeasonArtifact ... > D-08/D-09: a scheduled match publishes predicted fields with every actual field undefined, and the row parses; #publishSeasons ... > orders a team's matches within an event by sortTime ..."
        status: pass
    human_judgment: false
  - id: D4
    description: "withPercentiles computes the mid-rank percentile over the FULL season team pool (never a subset), rounds to 1 decimal, never mutates its input, and omits the percentile key entirely for a team with no value on a metric; wired into publish.ts at the single metricsByTeam reuse point and consumed only by the per-team artifact this phase"
    requirement: "TEAM-03"
    verification:
      - kind: unit
        ref: "packages/harness/percentiles.test.ts (13 cases: mid-rank formula, ties, single-team pool, order preservation, tier-boundary crossings, pool scoping, immutability, rounding); packages/harness/publish.test.ts#publishSeasons ... > D-04/D-03/D-05: percentile, robotImageUrl and activeYears all reach the team artifact from their respective single insertion points"
        status: pass
    human_judgment: false
  - id: D5
    description: "robotImageUrl (D-03) resolved once per season from selectTeamMediaForYear, present when the corpus has a URL and absent (never null) when it does not; activeYears (D-05) built from a cross-season pre-pass, sorted ascending, and a run narrower than 5 seasons logs an explicit under-reporting warning naming the seasons in scope"
    requirement: "TEAM-02"
    verification:
      - kind: unit
        ref: "packages/harness/publish.test.ts#publishSeasons ... > D-04/D-03/D-05: ... ; > logs a warning naming the seasons in scope when the run's season set is narrower than the full published range (D-05 under-reporting guard)"
        status: pass
    human_judgment: false
  - id: D6
    description: "The whole publisher validated against the real 2022-2026 corpus in dry-run mode across all three algorithms: pnpm publish:seasons --dry-run exits 0, objects=54671 (exact match to the recorded 54,671), no R2 write performed; the team page's new maximum byte size (304,862B for frc118/2024/sigma1) is measured and projected against the recorded 287,264B baseline and the 375,000B budget (headroom 18.70%); docs/publish-budget.md is untouched (this plan projects, plan 06-06 records)"
    requirement: "TEAM-05"
    verification:
      - kind: integration
        ref: "real `node node_modules/tsx/dist/cli.mjs --env-file=.env packages/harness/publish.ts --seasons 2022-2026 --dry-run` invocation (see Performance below for the full summary output); packages/harness/publish.test.ts#buildTeamSeasonArtifact ... > plan 06-04 Task 3: every field this phase added at once ..."
        status: pass
    human_judgment: false

duration: ~50min
completed: 2026-08-25
status: complete
---

# Phase 6 Plan 4: Publisher Wiring for Team-Page Fields Summary

**`publishSeasons`/`buildTeamSeasonArtifact` now populate every field 06-02 opened — own predicted-score variance, actual RP, mid-rank percentile, robot image URL, active years, and scheduled-match rows merged into the played-match list — validated end-to-end against the real 2022-2026 corpus in dry-run, with the team page's new payload ceiling measured at 304,862 bytes (81.3% of the 375,000-byte budget).**

## Performance

- **Duration:** ~50 min (task commits span 13:20:55–13:42:44 local time, ~22 min of that; the remainder is context loading, the real dry-run publish run against the full 2022-2026 corpus, and SUMMARY authoring)
- **Tasks:** 3 (3/3 complete)
- **Files modified:** 4 (2 created, 2 modified)

## Accomplishments

- **Fixed the pre-existing `eventName: eventKey` defect** (`meta` was already in scope one line above the bug site) — team-season event section headings now carry the real event name, with a documented fallback to the event key only when an un-refreshed corpus's `name` column is genuinely null.
- **D-01/D-02:** each alliance's own predicted-score variance and each match's actual bonus RP now reach the published team artifact, rounded/typed exactly per 06-02's documented contracts (own-variance reuses `ROUNDING_RULE.variance`; RP is never coerced from `null` to `0`).
- **D-08/D-09:** a team's scheduled matches merge into the same per-event match list as its played matches (an event a team is only scheduled to attend now produces its own section instead of being dropped), and the merged list is sorted by `sortTime` with the same `compLevel`/`setNumber`/`matchNumber`/`matchKey` tie-break chain `selectScheduledMatches` uses — proven independent of insertion order.
- **D-04:** a new `packages/harness/percentiles.ts` computes the mid-rank percentile `(countStrictlyBelow + 0.5*countEqual)/n*100` over a season's FULL team pool, in one `O(n log n)` pass; wired into `publish.ts` at the single existing `metricsByTeam` reuse point, but consumed only by the per-team artifact this phase (the teams/{year} artifact keeps its unwidened metrics record, per the recorded Open Question 2 scope boundary).
- **D-03/D-05:** `robotImageUrl` resolved once per season from 06-03's `team_media` table (present only when the corpus has a real URL, never a coerced value); `activeYears` built from a cross-season pre-pass over every requested season, sorted ascending, with an explicit console warning when a run's season set is narrower than 5 seasons (activeYears would otherwise silently under-report).
- **Validated for real:** `pnpm publish:seasons --dry-run` (invoked directly via `tsx --env-file=.env`) ran to completion against the real 336 MB corpus across all five seasons and all three algorithms — `objects=54671`, exit 0, zero R2 writes. The team page's new measured maximum is **304,862 bytes** (`v1/team/frc118/2024/sigma1@2.0.0+tuned-2026-08.json`), a **+17,598 byte (+6.13%) delta** against the recorded 287,264-byte baseline, leaving **70,138 bytes (18.70%) headroom** under the 375,000-byte budget. `docs/publish-budget.md` is untouched — this is a projection, not a re-baseline; plan 06-06 owns the real recorded run.

## Task Commits

Each task was committed atomically:

1. **Task 1: The per-match layer — event name, own variance, actual RP, and scheduled rows** - `857f2b62` (feat)
2. **Task 2: The per-team layer — percentiles, active years, and the robot image** - `20f21967` (feat)
3. **Task 3: Validate the whole publisher against the real corpus, and project the payload delta** - `c0016c0e` (test)

_No plan-metadata docs commit for STATE.md/ROADMAP.md — this executor was explicitly instructed not to touch them; the orchestrator updates both after every agent in the wave completes. This SUMMARY.md is committed separately below._

## Files Created/Modified

- `packages/harness/percentiles.ts` (new) - `percentileRanks` (mid-rank formula), `withPercentiles` (the one insertion-point pass over a season's full team pool, never mutating its input)
- `packages/harness/percentiles.test.ts` (new) - 13 cases: mid-rank formula on distinct/tied/single-value pools, order preservation, a 100-value tier-boundary crossing check, pool scoping via `teamKeys` (not `Object.keys(metricsByTeam)`), input/nested-object immutability, rounding
- `packages/harness/publish.ts` - `buildTeamSeasonArtifact`'s per-match mapper (own variance, actual RP, `setNumber`/`matchNumber`/`sortTime`, played-vs-scheduled discrimination via `"winner" in match`); the eventName fix; new module-local `selectScheduledMatchTimes`/`sortTeamSeasonMatches`/`COMP_LEVEL_RANK`; `publishSeasons`'s `scheduledPredictionsByEvent`/`scheduledTeamMatches` (shared between the event and team branches), the `activeYearsByTeam` pre-pass and its under-5-season warning, the per-season `teamMediaForSeason` lookup, the `metricsByTeamWithPercentiles` insertion; `roundTeamMetricRecord` widened to pass a present `percentile` through unchanged; `BuildTeamSeasonArtifactParams.seasonStats.metrics`/`robotImageUrl`/`activeYears`/`sortTimeByMatchKey` fields
- `packages/harness/publish.test.ts` - eventName regression (real name + null-column fallback) and only-scheduled-section-not-dropped case, ordering case, own-variance/actual-RP/scheduled-row fixture cases, percentile/robotImageUrl/activeYears/warning integration cases against a real in-memory corpus, and the Task 3 all-fields-at-once cross-field case

## Decisions Made

- **TEAM-02/03/04/05 left `requirements-completed: []`** — this plan ships the publisher-side wiring only; no client team page exists yet in this wave (06-05+ builds it). Matches the repo's established 06-02/ALGO-03/ALGO-04 precedent of not marking a shared multi-plan requirement complete until the plan that makes it user-visible lands.
- **Percentile consumption stays scoped to the per-team artifact this phase.** `withPercentiles` is structurally reusable by the teams/{year} artifact too (it already computes ranks across the same `teamsThisSeason` pool), but `teamsRows` deliberately keeps reading the unwidened `metricsByTeam` — widening that artifact's published surface is a later phase's decision per 06-RESEARCH.md's own Open Question 2.
- **Scheduled predictions computed once per event, shared by both the event branch's `upcoming` array and the team branch's per-team grouping** — a single `algorithm.predict(state, match)` call per scheduled match rather than one per (event, team) pairing, an efficiency choice consistent with the plan's own framing for the event branch (not separately required by the plan text for the team branch, but avoided duplicating the same computation).
- **`roundTeamMetricRecord` widened to carry a present `percentile` through unrounded** (it is already rounded once at `withPercentiles`) rather than silently dropping it — necessary for D-04's percentile to survive the publish-boundary rounding pass on its way into `seasonStats.metrics`. Every other existing call site (events/teams artifacts) is unaffected, since a plain `TeamMetric` simply has no `percentile` field to lose.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `BuildTeamSeasonArtifactParams.seasonStats.metrics` typed narrower than what Task 2's own wiring passes at runtime**
- **Found during:** Task 3, writing the all-fields-at-once cross-field test
- **Issue:** The interface declared `metrics: Record<string, TeamMetric>` (the core, percentile-less type), but `publishSeasons` had already been wiring `metricsByTeamWithPercentiles[teamKey]` (a percentile-carrying record) into this exact field since Task 2 — the static type simply understated what the function actually receives and needs to type-check a literal test fixture carrying `percentile` explicitly.
- **Fix:** Widened the field to `Record<string, TeamMetricWithPercentile>` (percentile optional, so every existing plain-`TeamMetric` caller — including every pre-Phase-6 test — remains valid unchanged).
- **Files modified:** `packages/harness/publish.ts`
- **Verification:** `node node_modules/typescript/bin/tsc --noEmit` clean repo-wide; full test suite still 1185/1185 green.
- **Committed in:** `c0016c0e` (Task 3 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — a type-accuracy bug, not a behavior change).
**Impact on plan:** No scope creep; the fix only makes an already-true runtime fact visible to the type checker.

## Issues Encountered

- **`team_media`'s `team_key` column carries a `REFERENCES teams(team_key)` foreign key** — the Task 2 corpus-integration test's first attempt at `upsertTeamMedia` for `frc1` failed with `SqliteError: FOREIGN KEY constraint failed` because no `teams` row existed for that key in the test fixture's fresh in-memory-style corpus. Fixed by calling `upsertTeam(db, { teamKey: "frc1", teamNumber: 1, nickname: "" })` before `upsertTeamMedia` in that one test — not a code defect, a missing fixture step.
- **`vi.spyOn(console, "log")` did not intercept calls made from inside `publish.ts`** in this repo's vitest `node` project (confirmed via a direct sanity-check call that also went unrecorded) — worked around by manually reassigning `console.log` to a capturing function and restoring it in a `finally` block for the under-5-seasons warning test. Not investigated further (out of scope for this plan); flagging here in case a future test author hits the same thing.
- **`pnpm publish:seasons --dry-run`** (the plan's literal `<verify>` command) routes through `pnpm run`, which on this machine can trip the same `pnpm install`/`better-sqlite3` node-gyp pre-check documented as a known machine condition. Invoked the equivalent command directly instead — `node node_modules/tsx/dist/cli.mjs --env-file=.env packages/harness/publish.ts --seasons 2022-2026 --dry-run` — which ran to completion (exit 0) without touching the install step. Same established pattern this phase's other plans have used for `pnpm test`/`pnpm typecheck`.

## User Setup Required

None — no external service configuration required. `.env`'s `TBA_API_KEY`/R2 credentials were never read, printed, or interpolated; the dry-run publish reached the R2 credential pair only via the established `tsx --env-file=.env` pattern, and no upload was attempted (`--dry-run`).

## Next Phase Readiness

- Every field `06-02` opened on the published schema is now populated by the real publisher, proven against the real 2022-2026 corpus in dry-run at full scale (54,671 objects, exit 0). The next real `pnpm publish:seasons` run (plan 06-06's job) will carry all of it to R2.
- The team page's projected new maximum (304,862B) has comfortable headroom (18.70%) under the 375,000B budget — no budget conversation is needed before 06-06's real run.
- `packages/harness/percentiles.ts`'s `withPercentiles` is structurally ready for the teams/{year} artifact to consume too, whenever a future phase decides to add tier boxes there (06-RESEARCH.md Open Question 1) — no further plumbing change would be needed at the insertion point, only a new call site.
- No blockers for the client-side team page plans (06-05+): every field TEAM-02 through TEAM-05 need is now on the wire, all optional at the schema level, so client work can proceed against the widened shapes immediately (matching 06-02's own "safe to build against before the republish lands" note).

## Self-Check: PASSED

All created/modified files and all 3 commits (`857f2b62`, `20f21967`, `c0016c0e`) verified present in the working tree and git log.

---
*Phase: 06-team-pages*
*Completed: 2026-08-25*
