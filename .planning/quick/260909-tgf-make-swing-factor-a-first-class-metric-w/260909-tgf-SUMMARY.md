---
phase: quick-260909-tgf
plan: 01
subsystem: ui
tags: [rarity-tiers, percentile, metric-direction, teams-table, season-header, publish-pipeline]

requires: []
provides:
  - "SWING_METRIC_KEY (\"swing\") declared once in swingFactor.ts, imported everywhere else"
  - "metricDirection.ts: declared per-metric direction table with strict (throws) and lenient (defaults higher-is-better) accessors, plus goodnessPercentile inversion"
  - "swingMetric.ts: running-median-over-rating-neighbours expected-swing curve and the residual percentile it feeds"
  - "publish.ts merges the swing metric into both the teams row (tier) and the team-season artifact (percentile), computed once per (algorithm, season)"
  - "Teams-table Swing column and SeasonHeader Swing tile both render a rarity tier sourced from the published entry"
affects: [rankings, ui-teams-table, ui-team-page, next-republish]

actuals:
  tokens: 19000
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Declared per-metric direction table (strict/lenient accessor split) as the general mechanism for any future lower-is-better metric"
    - "Running-median-over-rating-neighbours as a non-parametric expected-value curve, used here for swing-vs-rating"
    - "Synthetic metric injection at publish time: a SigmaScout-layer quantity computed outside AlgorithmModule.teamMetrics, merged into the metrics record before the percentile/tier machinery runs"

key-files:
  created:
    - packages/harness/metricDirection.ts
    - packages/harness/metricDirection.test.ts
    - packages/harness/swingMetric.ts
    - packages/harness/swingMetric.test.ts
  modified:
    - packages/harness/swingFactor.ts
    - packages/harness/percentiles.ts
    - packages/harness/percentiles.test.ts
    - packages/harness/publish.ts
    - packages/harness/publish.test.ts
    - apps/web/src/components/teams-table/rowModel.ts
    - apps/web/src/components/teams-table/rowModel.test.ts
    - apps/web/src/components/teams-table/columns.tsx
    - apps/web/src/components/teams-table/columns.test.tsx
    - apps/web/src/components/team/SeasonHeader.tsx
    - apps/web/src/components/team/SeasonHeader.test.tsx

key-decisions:
  - "D1 (locked): percentile the RESIDUAL against an expected-swing curve, never the raw Swing Factor or a ratio"
  - "D2 (locked): direction is a declared per-metric fact (strict throws for CI coverage, lenient defaults higher-is-better for the publish hot path), not a swing special case; swing is the sole lower-is-better entry, pinned by equality"
  - "D2 override recorded in code: sigma1/swing.ts's two-sided framing (Alliance 8 wants HIGH swing) is deliberately overridden for TIER purposes only, by developer decision 2026-09-09"
  - "D3 (locked): tier boxes render in exactly two places (SeasonHeader tile, teams-table Swing column); MetricValue.tsx's superscript path is untouched"
  - "Functional form (discretion, D1): running median over a rating-rank window sized max(25, round(n/20)), clamped to n, centred on each team itself -- assumes no functional form, robust to outliers by construction, no bucket edges"
  - "Task 2 exported withPublishedTiers from publish.ts (previously module-private) so its swing tier-stamping behaviour has a direct unit test"
  - "Task 3: the plan's rowModel.test.ts spec named a hypothetical 'sortable Swing column' sort key; the real sortable path is the published SWING_METRIC_KEY inside row.metrics (via the generic sortValueFor), not a special-cased 'swingScore' id -- the column is not currently in sortableColumnIds at all, unchanged by this task -- so the regression pin tests sorting by SWING_METRIC_KEY instead"

requirements-completed: [QT-260909-tgf]

coverage:
  - id: D1
    description: "Swing Factor publishes as a swing metric entry on every algorithm's teams row (value+tier) and team-season artifact (value+percentile), computed once per (algorithm, season)"
    requirement: "QT-260909-tgf"
    verification:
      - kind: unit
        ref: "packages/harness/publish.test.ts#buildTeamsArtifact — swing metric (quick task 260909-tgf)"
        status: pass
      - kind: unit
        ref: "packages/harness/publish.test.ts#buildTeamSeasonArtifact — swing metric (quick task 260909-tgf)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Percentile is the residual against an expected-swing curve fitted over the season pool, inverted so lower swing ranks higher; a high-rated/high-raw-swing team can out-tier a low-rated/low-raw-swing team"
    requirement: "QT-260909-tgf"
    verification:
      - kind: unit
        ref: "packages/harness/swingMetric.test.ts#swingMetricByTeam — THE HEADLINE TEST"
        status: pass
    human_judgment: false
  - id: D3
    description: "Direction is a declared per-metric fact via a strict/lenient accessor split, not a swing special case; publish-time behaviour for an unknown metric name is unchanged"
    requirement: "QT-260909-tgf"
    verification:
      - kind: unit
        ref: "packages/harness/metricDirection.test.ts (full suite)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Tier boxes render on the SeasonHeader Swing tile and the teams-table Swing column, and nowhere else; a stale artifact still renders the value with no fabricated ring"
    requirement: "QT-260909-tgf"
    verification:
      - kind: unit
        ref: "apps/web/src/components/team/SeasonHeader.test.tsx#SeasonHeader — Swing tile tier (quick task 260909-tgf)"
        status: pass
      - kind: unit
        ref: "apps/web/src/components/teams-table/columns.test.tsx#buildColumns — swing tier (quick task 260909-tgf)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Visual check on /teams and a team page after the developer's republish — most consistent robots (not merely weakest) are gold, and an elite team with honest swing is not automatically grey"
    verification: []
    human_judgment: true
    rationale: "Requires a live republish (D4/no-republish rule) and a visual read of real data; cannot be verified by unit tests alone. Developer follow-up item."

duration: ~1h50m (single continuous session)
completed: 2026-09-10
status: complete
---

# Quick Task 260909-tgf: Swing Factor as a first-class metric with rarity tiers — Summary

**Swing Factor now publishes as a `swing` metric percentiled against a running-median expected-swing-vs-rating curve, with the tier direction inverted at the pipeline so a more consistent robot always earns the higher tier — surfaced on the SeasonHeader tile and the teams-table Swing column, nowhere else.**

## Performance

- **Duration:** ~1h50m
- **Tasks:** 3/3 complete
- **Files modified:** 14 (4 new, 10 modified)
- **Commits:** 3 task commits, no plan-metadata commit (orchestrator handles docs)

## Accomplishments

- **Declared per-metric direction mechanism** (`metricDirection.ts`): a strict accessor that throws on an undeclared name (used by CI coverage, derived from every registered season's component map so a new season is covered automatically) and a lenient accessor that defaults to higher-is-better (used by the publish hot path, preserving today's graceful-degradation behaviour for an unknown metric name). `swing` is the sole lower-is-better entry, pinned by equality so a future addition can't slide in silently.
- **Expected-swing curve and residual** (`swingMetric.ts`): a running median over the `k = max(25, round(n/20))` rating-rank-nearest teams, own window centred on itself — assumes no functional form, robust to a single 10x outlier by construction (measured: neighbour's expected value shifts by <1.0), no bucket-edge discontinuities. The headline test builds a pool where a high-rated team with objectively higher raw swing (but below its own expected value) strictly out-tiers a low-rated team with objectively lower raw swing (but above its own expected value) — proving strong robots are no longer automatically high-swing.
- **Publish-side wiring** (`publish.ts`): one `swingMetricByTeam` call per (algorithm, season), merged into the teams row *before* `withPublishedTiers` (so it gets `tier`, never `percentile` — a negative test proves the percentile-on-teams-row case throws) and into the team-season artifact's `seasonStats.metrics` *with* percentile kept. The top-level `swingFactor` field is untouched on both artifacts — load-bearing for the live worker, `eventMatchAxis.ts`, and the stale-artifact fallback.
- **UI wiring** (`rowModel.ts`, `columns.tsx`, `SeasonHeader.tsx`): both display sites read the published entry's tier directly (defaulting to Common only when the entry is *present*, never when it's genuinely absent), rendered through the existing `MetricValue`/`tierForPercentile` machinery so no colour, cut, or class name changed anywhere. A stale, pre-republish row still shows its swing value with zero ring — never a fabricated one.

## Task Commits

1. **Task 1: The expected-swing curve, the residual, and a DECLARED metric direction** — `d17d916c` (feat)
2. **Task 2: Publish the swing metric onto both artifact families** — `00fbf0f2` (feat)
3. **Task 3: Tier boxes on the Swing tile and the Swing column — and only there** — `21539518` (feat)

_No plan-metadata commit — the orchestrator handles the docs commit (SUMMARY.md/STATE.md/ROADMAP.md) after this file lands._

## Files Created/Modified

- `packages/harness/swingFactor.ts` — `SWING_METRIC_KEY` export, header rewritten to describe Swing Factor as an injected synthetic metric
- `packages/harness/metricDirection.ts` (new) — the declared direction table, strict/lenient accessors, `goodnessPercentile`
- `packages/harness/metricDirection.test.ts` (new)
- `packages/harness/swingMetric.ts` (new) — `expectedSwingByTeam`, `swingMetricByTeam`
- `packages/harness/swingMetric.test.ts` (new)
- `packages/harness/percentiles.ts` — `withPercentiles` applies the declared direction via `goodnessPercentile`
- `packages/harness/percentiles.test.ts` — regression pin + first lower-is-better assertion
- `packages/harness/publish.ts` — computes and merges the swing metric onto both artifacts; exported `withPublishedTiers`
- `packages/harness/publish.test.ts` — round-trip, negative-percentile-throw, and rounding coverage
- `apps/web/src/components/teams-table/rowModel.ts` — `swingTier` derivation, two-branch fallback logic
- `apps/web/src/components/teams-table/rowModel.test.ts`
- `apps/web/src/components/teams-table/columns.tsx` — Swing column renders through `MetricValue`
- `apps/web/src/components/teams-table/columns.test.tsx`
- `apps/web/src/components/team/SeasonHeader.tsx` — `SwingScoreTile` tier-boxed
- `apps/web/src/components/team/SeasonHeader.test.tsx`

## Decisions Made

- See `key-decisions` in frontmatter. All five plan-locked decisions (D1-D5) implemented as specified; no deviations from the locked decisions.
- Test-design decision (documented above and in-code): `rowModel.test.ts`'s "sortable Swing column" regression pin uses `SWING_METRIC_KEY` as the sort key rather than the column's `"swingScore"` accessor id, because that id is not currently in `sortableColumnIds` at all (unchanged by this task) — the generic `sortValueFor` mechanism already works correctly against the published `swing` entry inside `row.metrics`, which is what the pin actually needed to prove.

## Deviations from Plan

None — plan executed exactly as written, including all five locked decisions and the scope fence (no event-artifact, metric-history, worker, `MetricValue.tsx`, `tiers.ts`, or `theme.css` edits).

## Issues Encountered

- **Concurrent-session interference (environmental, not a defect):** three other sessions committed work directly to `main` during execution (`260909-t5q` cold-start unification, `260909-tiq` match-page links, `260909-tom` bubble chart), and `260909-t5q`'s changes were staged-but-uncommitted in the working tree when Task 3 was ready to commit. Task 3 used `git commit -- <explicit paths>` (pathspec-restricted) rather than a plain `git commit` specifically to avoid absorbing that foreign staged content — verified afterward via `git show --stat` that the commit contains exactly its six intended files. Full-repo `npx vitest run` intermittently failed 1-3 files across three separate runs, always tracing to that same concurrent cold-start work (a `coldStart` field/type landing mid-flight), never to any file this plan touched.
- **Orchestrator re-verification (2026-09-10):** all three commits independently re-checked with `git show --stat` — each contains exactly its declared files, no foreign content. The swing pipeline suites (52 tests) and the publish + UI suites (327 tests) were re-run from the repo root and are green.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- **The republish (D4).** Nothing in this change renders on the live site until seasons are republished to R2 via `pnpm publish:seasons`, run from the main context (network-sandboxed subagents cannot do this). Every page keeps rendering its swing VALUE in the meantime via the preserved top-level `swingFactor` fallback — only the tier ring is missing until then.
- **`docs/publish-budget.md` is a manual transcription step.** `publish:seasons` prints its size summary but does not write the doc. The `swing` key adds one positional slot to every teams row and one metric entry to every team-season artifact. Transcribe the new numbers after the republish or `payloadBudget.test.ts` will start failing against a stale committed budget.
- **Visual check after the republish.** Needs `VITE_ARTIFACT_ORIGIN=local` to activate the `/v1` proxy (R2 CORS blocks localhost) and a fresh port per restart. Confirm on `/teams` that the most consistent robots — not merely the weakest — are the gold ones, and that an elite team with an honest, level-appropriate swing is not automatically grey. Tracked as coverage item D5 (`human_judgment: true`) above.

---
*Phase: quick-260909-tgf*
*Completed: 2026-09-10*
