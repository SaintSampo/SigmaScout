---
quick_id: 260927-uen
date: 2026-09-27
description: >-
  Team page header tiers from the season cut points during live folds: the
  Total tile, the phase tiles and the World rank card resolve their rarity tier
  through resolveMetricTier with the team artifact's own tierCuts when the live
  tick has stripped the published percentile. Closes todo
  live-merges-drop-percentiles.
status: planned
phase: quick-260927-uen
plan: 01
type: execute
wave: 1
depends_on: []
autonomous: true
requirements: [quick-260927-uen]
files_modified:
  - apps/web/src/components/team/SeasonHeader.tsx
  - apps/web/src/components/team/SeasonHeader.test.tsx
  - apps/web/src/components/team/RankCards.tsx
  - apps/web/src/components/team/RankCards.test.tsx
  - apps/web/src/routes/team.$teamNumber.test.tsx
  - apps/web/src/lib/tiers.ts
  - .planning/todos/pending/live-merges-drop-percentiles.md
  - .planning/todos/completed/live-merges-drop-percentiles.md
  - apps/worker/src/scheduled.ts
  - apps/worker/src/artifactMerge.ts
  - docs/worker-operations.md

estimate:
  tokens: 65000
  raw_tokens: 130000
  tasks: 3
  confidence: high

must_haves:
  truths:
    - "A live-folded team page (header metric entries with a value and no percentile, artifact carrying tierCuts) renders the Total tile and every published phase tile with the tier tierCuts gives the DISPLAYED value"
    - "A published percentile on any header metric still decides its tier, even where tierCuts would give a different one"
    - "The World rank card takes the published seasonStats Total percentile's tier when there is one; otherwise the last-official snapshot row's Total tier (its own published percentile, else tierCuts on its value); never tierCuts on the live seasonStats Total value; no snapshot row means no tier"
    - "A client-derived group tile (withDerivedGroupMetrics) and the Sigma pill never take a tier from tierCuts"
    - "An artifact with no tierCuts renders exactly as before this task"
    - "The todo sits in .planning/todos/completed with a closing STATUS block, and no code or doc comment still points at its old pending path or calls it open"
  artifacts:
    - path: apps/web/src/components/team/SeasonHeader.tsx
      provides: "tile, Total and World tier resolution from artifact.tierCuts"
      contains: "resolveMetricTier"
    - path: apps/web/src/components/team/RankCards.tsx
      provides: "World card renders a resolved tier passed in by SeasonHeader"
      contains: "worldTier"
    - path: apps/web/src/components/team/SeasonHeader.test.tsx
      provides: "live-folded, published-wins, no-cuts, derived-guard, override-source and Sigma-guard cases"
    - path: .planning/todos/completed/live-merges-drop-percentiles.md
      provides: "closed todo with a 2026-09-27 STATUS block"
  key_links:
    - from: apps/web/src/components/team/SeasonHeader.tsx
      to: apps/web/src/lib/tiers.ts
      via: "resolveMetricTier(entry, metricKey, artifact.tierCuts)"
      pattern: "resolveMetricTier\\("
    - from: apps/web/src/components/team/SeasonHeader.tsx
      to: apps/web/src/components/team/RankCards.tsx
      via: "worldTier prop"
      pattern: "worldTier="
---

<objective>
Give the team page header its rarity tiers back while a live event is being folded. Since
260923-3w6 the tick rewrites the team-season artifact, and `touchedEventTeamMetrics`
(`apps/worker/src/artifactMerge.ts` ~652) writes `seasonStats.metrics` as rounded values with no
`percentile`. It does this on the fold path and on the schedule-only path as soon as a schedule is
posted (`scheduled.ts` ~986-992). The header tiers only from a published percentile, so the Total
tile, the phase tiles and the World rank card go untiered until the next republish. The team
artifact has carried the season `tierCuts` block since 260923-3x0, and `EventSection` already
resolves through `resolveMetricTier`. This task wires the header the same way and closes the todo.

Purpose: a live-folded team keeps the tier colours the Teams list and the event cards already show.
Output: a web-only rendering change with tests, the todo moved to completed, and the stale todo-path
comments swept. No Worker behaviour, publisher, or artifact-shape change. No republish and no deploy.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.claude/CLAUDE.md
@.planning/todos/pending/live-merges-drop-percentiles.md
@.planning/quick/260923-3x0-team-artifact-tier-cuts/260923-3x0-SUMMARY.md
@apps/web/src/components/team/SeasonHeader.tsx
@apps/web/src/components/team/RankCards.tsx
@apps/web/src/components/team/EventSection.tsx
@apps/web/src/lib/tiers.ts
@packages/harness/tierCuts.ts

## Findings established before planning (cite them, do not re-derive)

1. **The four header keys are exactly the history-percentile allowlist, ranked against the same
   pool the cuts come from.** `HISTORY_PERCENTILE_METRIC_KEYS` (`packages/harness/percentiles.ts:444`)
   is the three `COMPONENT_GROUP_METRIC_KEYS` plus `total`, and those are exactly the header's tile
   keys (`METRIC_GROUPS` plus `TOTAL_KEY`). The publisher ranks history rows
   (`withHistoryPercentiles`, `publish.ts:214`), `seasonStats` (`withPercentiles` or the season-final
   branch of `seasonStatsMetricsForTeam`, `publish.ts:264-275`) and the cuts
   (`buildTierCutsFromPools(rankingPools)`, `publish.ts:2087`) against ONE `rankingPools`.
   `publish.test.ts:3223` pins the last official row's percentile equal to `seasonStats`' for these
   keys. `tierFromCuts` reproduces `publishedTierForPercentile(goodnessPercentileAgainstPools(...))`
   exactly, and `packages/harness/tierCuts.test.ts` proves it. **Call:** for every tile, and for the
   `metricsOverride` row (the last official history row, from `officialSnapshotRow`), cuts give
   exactly the tier the publisher would stamp on that displayed value. Apply them to every tile.
2. **Derived group entries are the exception.** `withDerivedGroupMetrics`
   (`apps/web/src/lib/metricGroups.ts`) sums the present components client-side for a stale artifact
   with no published group entry. That sum is not guaranteed to equal the value the publisher would
   rank, because it adds rounded components. The module's header also forbids a client-derived
   tier. **Call:** an entry that is in `metrics` but not in `resolvedMetrics` (so it is derived)
   never takes a cut, and it stays untiered as it is today. In practice any artifact that carries
   `tierCuts` also publishes group entries, and the live tick's EPA and SPR `teamMetrics` emit them.
   The guard costs one comparison and keeps the documented rule true.
3. **The World card cannot fall back to cuts on the live `seasonStats` Total.** The tick overwrites
   `seasonStats.metrics` with the algorithm's CURRENT state. That covers every scheduled team on
   the schedule-only path (`scheduled.ts:1026` and `1107`) and every offseason fold, where
   `metricsBasis` flips to `season-final` (`artifactMerge.ts:618`). Offseason folds are the ONLY
   live folds in late September. The rank on the card is the publisher's last-official-snapshot
   rank, carried by the tick's `...existing` spread, and the Teams list's Total tier describes that
   same instant. Cuts on a post-offseason or current-state value would paint a tier the publisher
   never would, and it could disagree with the rank beside it, with the Teams list, and with the
   Total tile next to it. **Call:** the published `seasonStats` Total percentile still wins, as the
   existing comment requires. When it is absent, the tier comes from the last-official snapshot
   row's Total (`metricsOverride[TOTAL_KEY]`) through `resolveMetricTier`. That is the row's own
   published percentile, which Finding 1 pins equal to `seasonStats`', or cuts on its value for a
   live-folded official row. With no snapshot row there is no tier, the same as today. This departs
   from the orchestrator's "keyed on seasonStats Total" framing ONLY on the new fallback path.
   Record it in SUMMARY.md under Deliberate calls.
4. **The Sigma pill needs no change.** No algorithm's `teamMetrics` emits a `sigma` key: in
   `packages/core/algorithms`, only `simulation/allianceWinProbability.ts` reads `"sigma"`. The
   tick's Sigma travels separately as `sigmaAfterTick` and lands on history rows only
   (`artifactMerge.ts:583`). `touchedEventTeamMetrics` carries the prior published Sigma entry,
   percentile included, into `seasonStats.metrics`. Two tests already pin this:
   `apps/worker/test/scheduled.officialRecord.test.ts:298` (sigma carried UNCHANGED) and
   `apps/worker/test/scheduled.test.ts:1144-1231` (runTick keeps the seeded Sigma on both artifacts).
   `SeasonTierCutsSchema` never carries `sigma` (`pageArtifacts.ts:1255-1264`). The pill keeps
   `tierForPercentile` only. This task adds a web guard test for that and no Worker test.
5. **No web surface prints a percentile NUMBER.** The percentile only selects a tier colour, and
   the World card prints `#rank` and `of total` (`RankCards.tsx:120-127`). So the todo's "number"
   half needs no work. `allianceTierApproximation.ts` still needs published percentiles as
   interpolation points, so the Alliances Combined Total tier still thins during live folds.
   Cuts give a tier, not the number that interpolation needs, so this stays out of scope.

## Working-tree hazard

Another session is committing on this checkout. At the planner's snapshot it had uncommitted edits
under `apps/web/src/components/districts/` and `apps/web/src/components/methodology/`. Run
`git status --short` before the first edit and keep that list as the peer baseline. Never
`git add -A`, `git add .`, `git stash` or `git commit -a`. Stage only the explicit paths each task
names. If a vitest or tsc failure is confined to a file in the peer baseline, it is the peer's
in-flight work. Record it in SUMMARY.md and do not fix or stage it. Do not push, because pushing is
the orchestrator's call.

This is a tier-assignment change, not a visual one. Every tier class already exists and is styled,
so `sketch-findings-sigmascout` does not need loading.
</context>

<tasks>

<task type="tracer" tdd="true">
  <name>Task 1: Tracer — the header Total tile tiers from the team artifact's own tierCuts, proven through the real route</name>
  <files>apps/web/src/components/team/SeasonHeader.tsx, apps/web/src/routes/team.$teamNumber.test.tsx</files>
  <behavior>
    - Route level, live-folded artifact WITH `tierCuts` (reuse `artifactWithLiveFoldedRow(true)` in the "one artifact, no overlay (260923-3w7)" describe): the header's `season-header-metric-grid` contains the tier element for the value the header actually displays.
    - Route level, the same artifact WITHOUT `tierCuts` (`artifactWithLiveFoldedRow(false)`): the grid contains no `.metric-tier` element. Non-vacuity: the grid's text still contains the displayed Total value.
  </behavior>
  <action>
    RED first. Add two new `it` cases, each prefixed `260927-uen:`, beside the two existing
    260923-3x0 route cases. Leave those two cases untouched. Before asserting a tier, read the
    rendered `season-header-as-of` label to learn which instant the header shows in this fixture. If
    it reads season-final, the header shows the fixture's `seasonStats` Total 48.33, and against cuts
    [31.17, 52.4, 88.05] the tier is rare. If it reads "As of last official match", the header shows
    the live-folded row's 61.4, which is epic. Pin the ONE tier that is deterministic for this
    fixture, not a disjunction, and put a one-line comment in the test naming which instant it is and
    why. Run both cases and confirm the WITH-cuts case fails before the implementation.

    GREEN. In `SeasonHeader.tsx`, the Total tile's `totalTier` becomes
    `resolveMetricTier(totalMetric, TOTAL_KEY, artifact.tierCuts)` instead of `tierForPercentile`.
    Import `resolveMetricTier` from `@/lib/tiers` beside `tierForPercentile`, which stays for the
    Sigma pill. Total is never a derived entry, because `withDerivedGroupMetrics` only adds group
    keys, so it needs no derived guard. Read `artifact.tierCuts` straight off the artifact. Do not
    add a `tierCuts` prop: the header already holds the whole artifact, unlike `EventSection`.

    Update the tile comment block near `resolvedMetrics` (~lines 77-81). A snapshot or seasonStats
    metric with a published percentile keeps it. A live-folded entry has none, and its tier comes
    from `artifact.tierCuts`, which is built from the same `rankingPools` every published percentile
    ranks against. Cite Finding 1's allowlist equality there in one or two sentences. Keep the file's
    long-explanatory-comment voice.
  </action>
  <verify>
    <automated>cd /c/Users/Jacob/Documents/GitHub/SigmaScout &amp;&amp; npx vitest run 'apps/web/src/routes/team.$teamNumber.test.tsx' apps/web/src/components/team/SeasonHeader.test.tsx 2>&amp;1 | tail -15</automated>
  </verify>
  <done>
    Both new route cases pass and the output shows them as passed rather than skipped. The two
    260923-3x0 route cases and every existing SeasonHeader case still pass. Commit with exactly
    `git add apps/web/src/components/team/SeasonHeader.tsx 'apps/web/src/routes/team.$teamNumber.test.tsx'`
    and the message `feat(260927-uen): the header Total tile tiers from the season cut points during live folds`,
    ending with the Co-Authored-By line `Claude Opus 5.5 <noreply@anthropic.com>`. Then run
    `git status --short` and confirm neither path is still listed.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Expand — phase tiles (derived guard), World rank card via worldTier, and the Sigma guard</name>
  <files>apps/web/src/components/team/SeasonHeader.tsx, apps/web/src/components/team/SeasonHeader.test.tsx, apps/web/src/components/team/RankCards.tsx, apps/web/src/components/team/RankCards.test.tsx, apps/web/src/lib/tiers.ts</files>
  <behavior>
    Add these to SeasonHeader.test.tsx in a new describe, "SeasonHeader — live-folded tiers from tierCuts (260927-uen)". Reuse `baseArtifact` and copy fixture shapes from the existing tests. Cells order is Total, Auto, Teleop, Endgame, per the test at ~line 162.
    - Live-folded seasonStats, no override: `total` 61.4, `phaseAuto` 16, `phaseTeleop` 12, `phaseEndgame` 2, all with no percentile. `tierCuts` are total [31.17, 52.4, 88.05], phaseAuto [5, 10, 15], phaseTeleop [10, 20, 30], phaseEndgame [4, 8, 12]. The tiles render epic, legendary, rare and common in that order: four distinct tiers from one render.
    - Published percentile wins: `total` is { value: 10, percentile: 97 } against total cuts [50, 60, 70], which would give common. The Total tile is legendary.
    - No `tierCuts` with the same live-folded values: the grid has no `.metric-tier` element and still shows the values.
    - Override row source: `seasonStats.total` is { value: 48.33 } (rare by cuts). `metricsOverride` is { total: { value: 61.4 } } with no percentile. Ranks are [{ scope: "world", rank: 12, total: 3481 }] and the total cuts are as above. The Total tile is epic, and the World card has `rank-card--epic` and NOT `rank-card--rare`. This pins Finding 3: never cuts on the live seasonStats value.
    - World fallback, published row percentile wins: seasonStats Total has no percentile. `metricsOverride` is { total: { value: 20, percentile: 96 } } against total cuts [50, 60, 70]. The World card is legendary.
    - World with no snapshot row: seasonStats Total has no percentile, tierCuts are present, and there is no `metricsOverride`. The World card class has no `rank-card--` modifier. Use a regex assertion, as the RankCards test at ~line 166 does.
    - World published percentile wins: seasonStats Total is { value: 10, percentile: 97 } against total cuts [50, 60, 70]. The World card is legendary. The existing test at ~line 506 stays green unchanged.
    - Derived guard: take the EPA stale-artifact fixture from the existing test at ~line 250 (components present, no published `phaseAuto`/`phaseTeleop`/`phaseEndgame`). Add `tierCuts` entries for all three group names with cuts low enough that the derived sums would clearly land in a band. The phase tiles still carry no `metric-tier` class. Non-vacuity: the derived values still render.
    - Sigma guard: seasonStats is { total: { value: 50 }, sigma: { value: 30 } } with no percentiles, and `tierCuts` is { sigma: { cuts: [1, 2, 3] } } with no `total` entry. `total-sigma-pill` contains no element whose class includes `metric-tier--`, and the pill text still contains the Sigma value. This fixture deliberately breaks the schema's never-a-sigma-cut invariant, so the test pins the header's own rule rather than the schema's.
  </behavior>
  <action>
    RED first: write the behaviors above and confirm the World, phase and Sigma cases fail or pass
    as expected before the implementation. The Sigma guard and derived guard should already pass,
    because they pin existing behaviour.

    `SeasonHeader.tsx`. `MetricGridCell` stops deriving its own tier. Its `tile` gains a `tier`
    field of type `Tier` (import the type from `@/lib/tiers`) and passes it to `MetricValue`. Each
    group tile's tier is `resolveMetricTier(metrics[group.metricKey], group.metricKey, cuts)`, where
    `cuts` is `artifact.tierCuts` only when `resolvedMetrics[group.metricKey]` is defined, and
    `undefined` otherwise (Finding 2's derived guard). Rewrite the comment at ~lines 98-102, which
    currently cites `tierForPercentile(undefined)`, to state the resolver, the guard, and why a
    derived entry must not take a cut.

    World card (Finding 3). Compute `worldTier` in the header. When
    `artifact.seasonStats.metrics[TOTAL_KEY]?.percentile` is defined, it is `tierForPercentile` of
    that. Otherwise it is `resolveMetricTier(metricsOverride?.[TOTAL_KEY], TOTAL_KEY, artifact.tierCuts)`.
    Pass `worldTier` to `RankCards`. Rewrite the JSX comment above `RankCards` (~lines 194-200).
    Keep its existing reason for the published path. Add the fallback: the tick rewrites
    `seasonStats.metrics` with current algorithm state (schedule-only path and offseason folds), so
    the live value is not the last-official instant the rank and the Teams list describe. The
    snapshot row is that instant by construction, and with no snapshot row there is no tier.

    Leave the Sigma pill's `tierForPercentile(seasonSigmaMetric?.percentile)` unchanged. Add one
    sentence to the Sigma derivation comment (~lines 104-117): the pill is never tiered from
    `tierCuts`, because Sigma's percentile is a rating-window rank the season pool cannot reproduce
    (`SeasonTierCutsSchema`'s doc comment), and the live tick carries the published Sigma entry,
    percentile included (Finding 4).

    `RankCards.tsx`. Replace the numeric World-percentile prop with `worldTier?: Tier` and use it
    directly for the world scope. Regional scopes keep
    `tierForPercentile(percentileForRank(entry.rank, entry.total))` unchanged. Rewrite the prop doc
    and the module header paragraph (~lines 16-21 and 85-90). The World card's tier arrives resolved
    from `SeasonHeader`, and the source rule lives there. It is never derived from the card's own
    rank, and an absent value renders no modifier. `SeasonHeader` is the only caller, and TypeScript's
    excess-property check fails any stale call site.

    `RankCards.test.tsx`. Update the three World-card cases (~lines 155-186) to pass `worldTier`:
    "epic" for the rank-1 case, absent for the no-modifier case, and "common" for the two-tier case.
    Keep what each one pins (the tier is not the rank's, absence means no modifier, and tiers are per
    card), and rename titles that name the old prop. The percentile-to-tier mapping for the World card
    is now pinned in SeasonHeader.test.tsx (the ~line 506 case plus the new ones).

    `tiers.ts`. Doc comment only, on `resolveMetricTier`. It says the fallback reads "the event
    artifact's `tierCuts` block", which has been stale since 260923-3x0. Say it reads the block on
    whichever artifact the caller holds (event or team-season), and name `SeasonHeader` alongside the
    existing callers. Change no code in this file.
  </action>
  <verify>
    <automated>cd /c/Users/Jacob/Documents/GitHub/SigmaScout &amp;&amp; npx vitest run apps/web/src/components/team apps/web/src/routes apps/web/src/lib/tiers.test.ts 2>&amp;1 | tail -20 &amp;&amp; (test -f apps/web/src/routeTree.gen.ts || (cd apps/web &amp;&amp; npx vite build >/dev/null 2>&amp;1)) &amp;&amp; npx tsc --noEmit -p apps/web/tsconfig.json 2>&amp;1 | tail -20</automated>
  </verify>
  <done>
    Every new SeasonHeader case and every updated RankCards case passes, and the counts in the output
    prove they ran. The web typecheck prints no error in any file this plan touches, and any error in
    a peer-baseline file is recorded rather than fixed. `git diff apps/web/src/lib/tiers.ts` shows
    comment lines only. Commit with exactly the five paths in this task's files list, using the
    message `feat(260927-uen): phase tiles and the World rank card tier from the season cut points; Sigma stays percentile-only`
    and the same Co-Authored-By line. Then run `git status --short` and confirm none of the five
    paths is still listed.
  </done>
</task>

<task type="auto">
  <name>Task 3: Close the todo, sweep its stale path references (comment-only in the Worker), full verification</name>
  <files>.planning/todos/pending/live-merges-drop-percentiles.md, .planning/todos/completed/live-merges-drop-percentiles.md, apps/worker/src/scheduled.ts, apps/worker/src/artifactMerge.ts, docs/worker-operations.md</files>
  <action>
    Move the todo. Run `git mv` from the pending directory to
    `.planning/todos/completed/live-merges-drop-percentiles.md` BEFORE any edit: on this machine an
    edit followed by `git mv` has silently dropped content. Then edit the file at its new path.
    Leave the frontmatter as it is. Insert a new blockquote directly under the frontmatter, above the
    existing 2026-09-23 STATUS block, that opens with `> **STATUS 2026-09-27: CLOSED (quick task 260927-uen).**`,
    following the convention of the recently completed todos (see
    `.planning/todos/completed/rp-fold-exceeds-worker-cpu-budget.md`). Keep it short, in plain
    declarative sentences, and cover:
    (a) The percentile NUMBER half needs no work, because no web surface prints a percentile number.
    It only selects a tier colour, and the World card prints a rank and its pool size.
    (b) The real gap was the team page header. The Total tile, the phase tiles and the World rank
    card tiered only from a published percentile, and the tick strips those percentiles from
    `seasonStats.metrics` on every fold and on schedule-only ticks. 260927-uen resolves the tiles
    through `resolveMetricTier` with the team artifact's `tierCuts`, and derived group tiles take no
    cut. The World card keeps the published `seasonStats` percentile, falls back to the last-official
    snapshot row, and never uses cuts on the live `seasonStats` value (one sentence on why).
    (c) The Sigma pill needed nothing, because the tick carries the published Sigma entry with its
    percentile. Cite the two worker tests from Finding 4.
    (d) Accepted and out of scope: the Alliances Combined Total tier still thins during live folds,
    because `allianceTierApproximation.ts` needs published percentiles as interpolation points and
    cuts give a tier, not a number.
    (e) The unscoped offseason `seasonStats` write (named as open by `artifactMerge.ts`'s seasonStats
    comment) is still how the Worker behaves. After this task, no web surface tiers or ranks from
    those live values except the header tiles of a team with no official snapshot. Those tiles are
    labelled season-final and tiered against the pool the publisher uses for a season-final basis.
    No reader-visible defect remains. Revisit only if a new surface reads `seasonStats.metrics` or
    `metricsBasis`, which today only `SeasonHeader` does.
    (f) Everything below is retained as history.
    Use no hyphen or dash characters as punctuation in the new prose. Code identifiers keep their
    own spelling.

    Sweep the references. Every reference to this todo's pending-directory path, and every sentence
    that calls it open, must name the completed file by its full path on a single line
    (`.planning/todos/completed/live-merges-drop-percentiles.md`) and say what closed. The sites are:
    `apps/worker/src/scheduled.ts` ~line 29 (file header, "Known accepted limitation, tracked in")
    and ~line 989 ("That is the existing, tracked"); `apps/worker/src/artifactMerge.ts` ~line 613
    ("stay open in", inside the `seasonStats` comment of `mergeTeamSeasonArtifact`) and ~lines
    634-650 (the `touchedEventTeamMetrics` doc: "the open half of", and "stays absent on every
    surface that prints one"); `docs/worker-operations.md` ~line 665 ("a separate, still-open
    question"). In the docs paragraph, also add half a sentence saying that the team page header and
    World rank card now tier from the same block (260927-uen).

    The Worker edits are COMMENT-ONLY: change no token of code. That keeps this a web-only change
    with no Worker deploy owed. A later deploy picks up the comments harmlessly. Leave
    `.planning/STATE.md` and the historical quick-task directories untouched, because those are
    records.

    Run this task's verify command BEFORE committing: its comment-only gate diffs the working tree
    against HEAD, and it would pass vacuously once the edits were committed.

    Full verification from the repo root, verified by reading output rather than trusting exit codes
    (this machine has a `timeout`+`pnpm` false-green failure mode). Run the whole vitest suite, the
    root tsc, the web tsc, and the worker tsc. Compare every failure against the peer baseline.

    Commit with exactly `git add .planning/todos/completed/live-merges-drop-percentiles.md apps/worker/src/scheduled.ts apps/worker/src/artifactMerge.ts docs/worker-operations.md`
    (the pending-side deletion is already staged by `git mv`). Use the message
    `docs(260927-uen): close live-merges-drop-percentiles; the header tier gap it hid is fixed`
    and the same Co-Authored-By line. Afterwards, `git status --short` must list neither todo path
    and none of the three swept files, and `git show --stat HEAD` must show a rename, not an add
    plus a leftover.
  </action>
  <verify>
    <automated>cd /c/Users/Jacob/Documents/GitHub/SigmaScout &amp;&amp; test -f .planning/todos/completed/live-merges-drop-percentiles.md &amp;&amp; test ! -e .planning/todos/pending/live-merges-drop-percentiles.md &amp;&amp; head -12 .planning/todos/completed/live-merges-drop-percentiles.md | grep -c "STATUS 2026-09-27: CLOSED" &amp;&amp; test -z "$(grep -rn 'todos/pending/live-merges-drop-percentiles' apps packages docs scripts --include=*.ts --include=*.tsx --include=*.md 2>/dev/null)" &amp;&amp; test "$(grep -rn 'live-merges-drop-percentiles' apps/worker/src docs/worker-operations.md | grep -vc 'todos/completed/live-merges-drop-percentiles.md')" = "0" &amp;&amp; test -z "$(git diff -U0 HEAD -- apps/worker/src | grep -E '^[+-]' | grep -vE '^(\+\+\+|---)' | grep -vE '^[+-][[:space:]]*(\*|//|/\*)')" &amp;&amp; npx vitest run 2>&amp;1 | tail -20 &amp;&amp; npx tsc --noEmit 2>&amp;1 | tail -10 &amp;&amp; npx tsc --noEmit -p apps/web/tsconfig.json 2>&amp;1 | tail -10 &amp;&amp; npx tsc --noEmit -p apps/worker/tsconfig.json 2>&amp;1 | tail -10</automated>
  </verify>
  <done>
    The todo is in completed with a 2026-09-27 STATUS block covering (a) to (f). No code or doc
    outside `.planning` points at the old pending path. Every Worker and doc mention of the todo
    names the completed file. The Worker diff is comment lines only. The repo-root vitest summary
    shows every file passing apart from recorded peer-baseline failures. All three typechecks print
    no error in any file this plan touches.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| R2 artifact to browser | The team-season JSON, including `tierCuts`, crosses into the client and is parsed by `TeamSeasonArtifactSchema` |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-260927-uen-01 | Tampering | `artifact.tierCuts` read by SeasonHeader | low | accept | Already bounded by `SeasonTierCutsSchema.optional().catch(undefined)`: a malformed block degrades to absent, which renders the pre-task untiered behaviour. A forged block can only mis-colour a tile on a page whose origin already controls every number shown. |
| T-260927-uen-02 | Repudiation (integrity of a published claim) | World rank card tier | medium | mitigate | The fallback source is the last-official snapshot row, never the live `seasonStats` value (Finding 3). Pinned by the Task 2 override-source test, which fails if the card takes the live value's tier. |
| T-260927-uen-03 | Information disclosure | secrets | low | accept | No task reads `.env`, and no network or publish step is involved. The CLAUDE.md secrets rules apply unchanged. |
</threat_model>

<verification>
- The header on a live-folded artifact with `tierCuts` shows tiered Total and phase tiles at both
  the component and the route level.
- A published percentile wins over cuts on every header surface, the World card included.
- The World card never takes a tier from the live `seasonStats` value.
- Derived group tiles and the Sigma pill never take a cut.
- An artifact without `tierCuts` renders exactly as before.
- The todo is closed, no reference is stale, and the Worker diff is comment-only.
- Repo-root vitest plus the root, web and worker tsc all pass, excluding recorded peer-baseline noise.
</verification>

<success_criteria>
A team whose file the live tick has rewritten keeps the same rarity colours on its header that the
Teams list and its event cards show. The colour comes from the same season pool, without a
republish. Every tier on the header is either a published percentile's or the exact reconstruction
of the tier the publisher would stamp on that displayed value. `live-merges-drop-percentiles` is
closed with its remaining limitations recorded rather than dropped.
</success_criteria>

<output>
Create `.planning/quick/260927-uen-team-header-tiers-from-season-cut-points/260927-uen-SUMMARY.md`
when done. Follow the 260923-3x0 SUMMARY's shape: per-commit sections, Deliberate calls
(Findings 2 and 3, and the Worker comment-only sweep), and Tests and build with the literal summary
lines. The "Is a republish needed?" answer is no: the block is already live on every
republished team file. If the Write tool is blocked for SUMMARY.md, return the full SUMMARY text to
the orchestrator instead. Do not route around the block with Bash heredocs.
</output>
