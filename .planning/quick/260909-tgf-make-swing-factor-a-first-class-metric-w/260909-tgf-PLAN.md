---
phase: quick-260909-tgf
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/harness/swingFactor.ts
  - packages/harness/metricDirection.ts
  - packages/harness/metricDirection.test.ts
  - packages/harness/swingMetric.ts
  - packages/harness/swingMetric.test.ts
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
autonomous: true
requirements: [QT-260909-tgf]

estimate:
  tokens: 95000
  raw_tokens: 190000
  tasks: 3
  confidence: med

must_haves:
  truths:
    - "Swing Factor is published as a metric entry under the key `swing` inside the metrics record of BOTH the teams/{year} artifact (value + tier) and the team/{teamKey}/{year} artifact (value + percentile), for every published algorithm (opr, epa, bpr)."
    - "The published swing percentile is computed from the team's RESIDUAL against a fitted expected-swing curve over the season pool, never from its raw Swing Factor and never from a ratio (D1)."
    - "The published swing percentile is INVERTED relative to the residual rank: a LOW residual (less swingy than robots of its caliber) earns a HIGH percentile and therefore Legendary (D2)."
    - "A HIGH-rated team with HIGH raw Swing Factor can out-tier a LOW-rated team with LOW raw Swing Factor. This is proved by a direct unit test, not asserted in prose."
    - "Metric direction is a DECLARED per-metric fact, not a swing special case, exposed as TWO accessors over ONE table: a strict `metricDirection(name)` that throws `UndeclaredMetricDirectionError`, used by the test suite, and a lenient `metricDirectionOrDefault(name)` that resolves an undeclared name to higher-is-better, used by the publish hot path. A future lower-is-better metric cannot silently rank the wrong way (D2) because the CI coverage test calls the STRICT form."
    - "The tier box renders in exactly two places: the SeasonHeader Swing Score tile and the teams-table `swingScore` column. `MetricValue`'s `± X` superscript render path is untouched (D3)."
    - "A stale, pre-republish artifact carrying only the top-level `swingFactor` field still renders its swing VALUE, with NO tier ring at all -- never a fabricated Common ring."
    - "The tier cuts and the client's tier derivation are unchanged: `apps/web/src/lib/tiers.ts` still delegates to `publishedTierForPercentile`, and neither file learns anything about direction. All inversion happens once, in the pipeline."
    - "`npx vitest run` from the REPO ROOT is green (167+ files), and both `npx tsc --noEmit` at the root and against apps/web/tsconfig.json are clean."
    - "No republish is attempted. No `pnpm publish:seasons`, no `pnpm publish:artifacts`, no network Bash of any kind (D4)."
  artifacts:
    - packages/harness/metricDirection.ts
    - packages/harness/metricDirection.test.ts
    - packages/harness/swingMetric.ts
    - packages/harness/swingMetric.test.ts
  key_links:
    - "`SWING_METRIC_KEY` is declared ONCE, in packages/harness/swingFactor.ts (a module already proven browser-safe by SwingPage.tsx's import), and is imported by the pipeline, the web rowModel and the tests. The string `\"swing\"` is never retyped anywhere."
    - "The strict/lenient accessor split is load-bearing and must NOT be collapsed into one throwing function. `percentiles.ts` sources its metric names from `Object.keys(metrics)` (:104) and `Object.entries(metrics)` (:217) -- an OPEN set of whatever the algorithm emitted, not a closed list -- and `percentiles.ts:133-141` documents graceful degradation on names the pipeline does not know as deliberate. A throw in that pass would turn today's graceful degradation into a hard crash partway through a multi-hour manual republish."
    - "`METRIC_DIRECTIONS` auto-populates its higher-is-better entries by iterating `BREAKDOWN_REGISTERED_SEASONS` x `componentMapForSeason(s).components`, a DERIVED source -- so registering a new season cannot silently leave its components undeclared. The lower-is-better key SET is pinned BY EQUALITY in the test, which is the iteration-list-trap antidote this project's history records."
    - "The swing metric entry is merged into the teams row metrics BEFORE `withPublishedTiers`, which strips `percentile` and stamps `tier`. This is what keeps `encodeTeamMetricEntry`'s percentile throw unreachable on the teams row."
    - "ONE `swingMetricByTeam` computation per (algorithm, season) feeds BOTH the teams row and the team-season artifact, so the Teams table and the team page cannot disagree about a team's swing value or its tier."
---

<objective>
Promote Swing Factor from a bare top-level `swingFactor` number to a first-class
published metric with rarity tiers, percentiled against an expected-swing curve
conditioned on the team's scoring ability, with the tier direction inverted so
that lower swing (more consistent) earns the higher tier.

Purpose: today a strong robot is automatically a high-swing robot, because raw
Swing Factor scales with how much a team scores. Percentiling the raw number
would just restate the ranking. Percentiling the RESIDUAL against a fitted
expected-swing curve answers the question a scout actually asks -- "is this robot
swingier than robots of its caliber?" -- and inverting the direction makes the
gold box mean what the developer says it should mean: more consistent is always
better.

Output: a declared per-metric direction mechanism, an expected-swing fit and
residual pass, a `swing` metric entry on both published artifact families, and
tier boxes on the two agreed display sites.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.claude/CLAUDE.md
@.planning/quick/260909-tgf-make-swing-factor-a-first-class-metric-w/260909-tgf-CONTEXT.md

Read before Task 3 (project instruction, non-optional for UI work):
@.claude/skills/sketch-findings-sigmascout/SKILL.md
@.claude/skills/sketch-findings-sigmascout/references/colour-and-tiers.md
</context>

<hard_rules>

These are not suggestions. Each one exists because it was broken before.

1. **NO REPUBLISH (D4).** Do not run `pnpm publish:seasons`, `pnpm
   publish:artifacts`, `pnpm publish:districts`, `pnpm harness`, or any command
   that touches R2 or TBA. Executor subagents are network-sandboxed; every
   network Bash call is denied, and an attempt fails confusingly rather than
   usefully. The republish is the developer's step, run from the main context
   after this task lands. Nothing in this plan renders on the live site until
   then, and that is expected.

2. **STAGE BY EXPLICIT PATH (D5).** Another session is editing this checkout
   concurrently. At plan time the working tree carried unrelated modifications to
   `apps/web/src/components/event/EventMatchTable.tsx`,
   `apps/web/src/components/team/MatchTable.tsx`,
   `apps/web/src/styles/theme.css`, `packages/core/rankingPoints/empiricalMoments.ts`
   and `packages/core/rankingPoints/empiricalMoments.test.ts`.
   **Never `git add -A`. Never `git add .`** Name every path on every commit, and
   run `git status` after each commit to confirm nothing foreign was absorbed.

3. **RUN TESTS FROM THE REPO ROOT.** `npx vitest run` from the repo root covers
   167 files; running it from `apps/web` covers 77 and has hidden red CI for eight
   days before. Root, always.

4. **NEVER `timeout <n> pnpm <cmd>`.** On this project that combination swallows
   all output and exits 0. Use `npx vitest run` / `npx tsc --noEmit` directly and
   judge by the printed output, never by the exit code alone.

5. **TYPECHECK BOTH PROJECTS.** Root `npx tsc --noEmit` returns clean with real
   errors present in `apps/web`. Also run `npx tsc --noEmit -p apps/web/tsconfig.json`.

6. **NEVER READ OR ECHO `.env`.** Not needed for any step in this plan.

</hard_rules>

<tasks>

<task type="tracer" tdd="true">
  <name>Task 1: The expected-swing curve, the residual, and a DECLARED metric direction</name>

  <files>
packages/harness/swingFactor.ts
packages/harness/metricDirection.ts
packages/harness/metricDirection.test.ts
packages/harness/swingMetric.ts
packages/harness/swingMetric.test.ts
packages/harness/percentiles.ts
packages/harness/percentiles.test.ts
  </files>

  <read_first>
packages/harness/swingFactor.ts (lines 1-60 -- the layering header this task must rewrite)
packages/harness/percentiles.ts (the whole file, 251 lines -- percentileRanks, withPercentiles, sortedPoolsByMetric)
packages/core/algorithms/breakdown/index.ts (BREAKDOWN_REGISTERED_SEASONS, componentMapForSeason)
packages/core/algorithms/types.ts (TOTAL_METRIC_KEY, TeamMetric, TeamMetrics)
packages/harness/percentiles.test.ts (lines 1-60 -- the suite's existing style)
  </read_first>

  <behavior>
Write these tests FIRST, in `metricDirection.test.ts`, `swingMetric.test.ts` and
as additions to `percentiles.test.ts`. They must fail before the implementation
lands.

`metricDirection.ts`:
  - `metricDirection(TOTAL_METRIC_KEY)` is `"higher-is-better"`.
  - `metricDirection(SWING_METRIC_KEY)` is `"lower-is-better"`.
  - STRICT accessor: `metricDirection("notAMetricAnyoneDeclared")` THROWS
    `UndeclaredMetricDirectionError`.
  - LENIENT accessor: `metricDirectionOrDefault("notAMetricAnyoneDeclared")`
    RETURNS `"higher-is-better"` and does not throw. This is the status-quo
    behaviour every unknown metric name already gets today, preserved for the
    publish path.
  - The two accessors agree on every DECLARED name -- assert equality across the
    whole declared key set, so the lenient form can never become a second,
    drifting table.
  - EQUALITY PIN (iteration-list-trap antidote): the exact set of keys declared
    lower-is-better deep-equals `new Set([SWING_METRIC_KEY])`. A future addition
    fails this test loudly rather than sliding in.
  - COVERAGE, derived not hardcoded, and it MUST call the STRICT accessor: for
    every season in `BREAKDOWN_REGISTERED_SEASONS`, every name in
    `componentMapForSeason(season).components` resolves through
    `metricDirection` without throwing. Calling the strict form HERE is the
    whole point of the split -- this test is where "nothing is silently
    undeclared" is enforced, so an undeclared component fails CI loudly while
    production degrades instead of crashing. Iterate
    `BREAKDOWN_REGISTERED_SEASONS` itself -- never a typed season list -- so
    registering a new season is covered automatically.
  - Each of `COMPONENT_GROUP_METRIC_KEYS`' three values resolves through the
    STRICT accessor without throwing.
  - `goodnessPercentile(80, "higher-is-better")` is `80`;
    `goodnessPercentile(80, "lower-is-better")` is `20`; the function is its own
    inverse for a given direction (`f(f(p)) === p`).

`percentiles.ts` -- `withPercentiles` gains direction awareness:
  - Every existing percentile assertion in `percentiles.test.ts` still passes
    UNCHANGED. Add an explicit regression pin: a two-team record on
    `TOTAL_METRIC_KEY` produces exactly the percentiles it produced before this
    task, i.e. higher value -> higher percentile.
  - A metric record containing a lower-is-better name ranks INVERTED: the lower
    value receives the higher percentile.

`swingMetric.ts`:
  - `expectedSwingByTeam` over a pool where swing rises linearly with rating
    returns, for each team, an expected value close to that team's own swing --
    so residuals are near zero across the whole rating range. Assert the max
    absolute residual is small relative to the swing spread; this is the property
    that kills "strong robots are automatically high-swing".
  - A single extreme outlier team (swing 10x its neighbours) does NOT drag the
    curve: its neighbours' expected values shift by less than a stated tolerance.
    This is what "robust to outliers" means and it must be measured, not claimed.
  - **THE HEADLINE TEST, and the entire point of this change.** Build a pool
    where a HIGH-rated team has a HIGH raw swing that is nonetheless BELOW the
    expected swing at its rating, and a LOW-rated team has a LOW raw swing that
    is nonetheless ABOVE the expected swing at its rating. Assert the
    high-rated/high-raw-swing team's published percentile is STRICTLY GREATER
    than the low-rated/low-raw-swing team's. Name the test so its intent is
    unmissable.
  - A team with no Swing Factor (fewer than two played matches) gets NO entry in
    the returned record at all -- never a coerced zero, never a present-and-zero
    percentile.
  - A team with a Swing Factor but no `total` metric value cannot be placed on
    the curve and therefore gets NO entry -- honest absence, matching
    `percentiles.ts`'s own "no value, no percentile" rule.
  - The pool is exactly the `teamKeys` argument, never `Object.keys(...)` of the
    metrics record -- the same pool-scoping rule `withPercentiles` and
    `sortedPoolsByMetric` both state.
  - Returned entries carry `{ value: <raw Swing Factor>, percentile: <inverted
    residual percentile> }` and no other keys.
  </behavior>

  <action>
Implement after the tests are red.

**1. `SWING_METRIC_KEY` in `packages/harness/swingFactor.ts`.** Export
`export const SWING_METRIC_KEY = "swing";` from this file and nowhere else.
Reason to put it here rather than in a new module: `swingFactor.ts` is already
imported by `apps/web/src/components/methodology/SwingPage.tsx`, so it is proven
browser-safe (no Node built-ins), which Task 3 needs when `rowModel.ts` imports
the same constant. Every other file imports it; the literal `"swing"` is never
retyped.

**2. Rewrite `swingFactor.ts`'s file header (CONTEXT specifics, mandatory).**
The current header's "THE TWO LEVELS, AND WHY THIS FILE IS NOT IN
`packages/core/algorithms`" section says Swing Factor is deliberately NOT part of
any algorithm and is not a metric. Promoting it to a published metric CROSSES
that boundary. Rewrite the section so it describes what is now true: Swing Factor
is a SigmaScout-layer quantity computed identically for every algorithm from
nothing but predicted and actual scores, INJECTED at publish time as a synthetic
metric entry under `SWING_METRIC_KEY` so it inherits the percentile/tier/sort
machinery -- while remaining outside every algorithm's own state and outside
`AlgorithmModule.teamMetrics`. Keep every measured constant and every measured
claim in the rest of the header byte-identical; this is a framing correction, not
a rewrite of the estimator's documentation. Leave a header comment saying
explicitly that the estimator itself did not change and the numbers did not move.

**3. New `packages/harness/metricDirection.ts`.**
Export:
  - `export type MetricDirection = "higher-is-better" | "lower-is-better";`
  - `export class UndeclaredMetricDirectionError extends Error` -- message names
    the offending metric name and says that every published metric must declare a
    direction.
  - A module-private registry built at module load: start from
    `BREAKDOWN_REGISTERED_SEASONS`, and for each season add every name in
    `componentMapForSeason(season).components` as `"higher-is-better"`; add
    `TOTAL_METRIC_KEY` and each of `COMPONENT_GROUP_METRIC_KEYS`' values as
    `"higher-is-better"`; add `SWING_METRIC_KEY` as `"lower-is-better"`. Deriving
    the component names rather than typing them is what makes a newly registered
    season covered automatically.
  - `export function metricDirection(metricName: string): MetricDirection` --
    the STRICT accessor. THROWS `UndeclaredMetricDirectionError` on an
    undeclared name rather than defaulting. Called by the test suite and by any
    future caller that genuinely requires a declaration.
  - `export function metricDirectionOrDefault(metricName: string): MetricDirection`
    -- the LENIENT accessor over the SAME table. Returns `"higher-is-better"`
    for an undeclared name. This is what the publish hot path calls.

**WHY TWO ACCESSORS, AND DO NOT COLLAPSE THEM INTO ONE.** Write this reasoning
into the file, because "simplify these two into the throwing one" is the obvious
and wrong refactor. `percentiles.ts` builds its metric-name set from
`Object.keys(metrics)` (:104) and `Object.entries(metrics)` (:217) -- an OPEN
set sourced from whatever the algorithm actually emitted, not a closed list
derived from `componentMapForSeason`. `percentiles.ts:133-141` documents that
tolerance as deliberate: `sortedPoolsByMetric` OMITS a metric name it has no
values for (PD-07) rather than failing on it, and `EmptyPoolError` exists
precisely so the unreachable case is a named defect signal instead of a silent
zero. Today an algorithm emitting a name the pipeline has never heard of degrades
gracefully. A throwing accessor in that pass would convert that into a hard crash
during `pnpm publish:seasons` -- a multi-hour job the developer runs by hand,
which is the worst possible place to fail. So: strictness lives in CI, tolerance
lives in production.

D2's "impossible for a future metric to silently default to the wrong direction"
is still satisfied, and it is worth writing down exactly how: every name in the
derived component map is covered by the STRICT coverage test below, so an
undeclared component fails CI loudly; and a genuinely unknown name ranking
higher-is-better is precisely the behaviour that already ships today, not a new
silent wrong this change introduces.
  - `export function goodnessPercentile(rawPercentile: number, direction: MetricDirection): number`
    -- returns `rawPercentile` for higher-is-better and `100 - rawPercentile` for
    lower-is-better. Document, at the function, that this exact identity holds for
    the mid-rank convention `percentileRanks` uses: reversing the sort order gives
    `(countStrictlyAbove + 0.5*countEqual)/n*100`, which is precisely
    `100 - p`. So an inverted percentile is a real mid-rank percentile of the
    reversed order, not an approximation.
  - `export function lowerIsBetterMetricKeys(): ReadonlySet<string>` -- the set
    the equality-pin test reads. Small, deliberate test seam.

**RECORD THE D2 OVERRIDE HERE, at the `SWING_METRIC_KEY` entry**, in a comment
substantial enough that nobody undoes it: `packages/core/algorithms/sigma1/swing.ts`
documents the opposite framing -- its user stories 1 and 2 say Alliance 1 wants
the LOWER swing and Alliance 8 deliberately WANTS the higher swing, making the
quantity two-sided. That two-sided framing is now OVERRIDDEN for tier purposes by
developer decision (2026-09-09): "more consistent is always always better". The
tier is a one-sided judgement even though the underlying quantity is arguably
two-sided. Do not "fix" this back to two-sided; it is a decision, not an
oversight.

**4. `percentiles.ts` -- apply the declared direction inside `withPercentiles`.**
Where `withPercentiles` assigns `percentile` today, wrap it:
`goodnessPercentile(pct, metricDirectionOrDefault(name))` -- the LENIENT
accessor, never the strict one, for the reason recorded at its declaration and at
`percentiles.ts:133-141`. Update the exported
`TeamMetricWithPercentile` doc and `withPercentiles`'s doc comment to say the
published `percentile` field now means GOODNESS rank, not value rank -- identical
for every higher-is-better metric (which is every metric that flows through this
function today), and reversed for a declared lower-is-better one. State that this
is what lets `publishedTierForPercentile` and `apps/web/src/lib/tiers.ts` stay
completely direction-unaware, preserving their single-source property.
Do NOT touch `percentileRanks`, `percentileAgainstSortedPool`,
`sortedPoolsByMetric`, `withHistoryPercentiles` or `HISTORY_PERCENTILE_METRIC_KEYS`
-- swing never flows through any of them (see Task 2's scope fence).

**5. New `packages/harness/swingMetric.ts`.**
Export `expectedSwingByTeam(...)` and `swingMetricByTeam(...)`.

The fit (D1's residual framing is locked; the functional form is discretion --
state the choice and its rationale in the file header):
Use a **running median over rating-rank neighbours**, not a parametric
regression. Sort the eligible teams ascending by their `total` metric value; each
team's expected swing is the MEDIAN Swing Factor of the `k` teams nearest it in
that rating ordering, its own window centred on itself. Choose
`k = max(25, round(n / 20))`, clamped to `n`. Residual = actual swing minus that
local median.

Write the rationale into the header, because the two rejected alternatives are
named in CONTEXT and a future reader will otherwise re-propose them:
  - It assumes NO functional form. Swing-vs-rating is not known to be linear, and
    a mis-specified curve would push its own shape into every residual.
  - The MEDIAN makes it robust to outliers by construction -- an Einstein-bias
    team or a two-match team with a wild figure moves its window's median by
    essentially nothing.
  - Every team gets its OWN window, centred on itself, so there are no bucket
    edges: two near-identical teams see near-identical windows and near-identical
    expected values. This is exactly what disqualified rating-decile strata.
  - It is O(n log n) to sort plus O(n*k) to sweep -- roughly 685k operations for
    a real 3,700-team season, computed once per (algorithm, season).
  - It has no low-rating instability, which is what disqualified the
    coefficient-of-variation ratio.

`swingMetricByTeam(params)` takes the season's `swingByTeam` map, the season-final
`metricsByTeam` record (for each team's `total` value -- the rating axis), and the
`teamKeys` pool. It:
  1. builds the eligible pool: teams in `teamKeys` that have BOTH a swing and a
     `total` value,
  2. computes each eligible team's expected swing and residual,
  3. ranks the residuals with `percentileRanks` from `percentiles.ts` -- imported
     and reused, never re-derived, so a swing percentile and a metric percentile
     mean the same thing and round the same way,
  4. inverts with `goodnessPercentile(pct, metricDirection(SWING_METRIC_KEY))` --
     the STRICT accessor is correct here, deliberately: `SWING_METRIC_KEY` is a
     name this same module declares, so a throw would mean the registry lost its
     own entry, which is a defect worth crashing on rather than degrading past.
     It is the SAME declared-direction mechanism the percentile pass uses, so
     swing is an instance of it rather than a second one,
  5. returns `Record<teamKey, { value: number; percentile: number }>` keyed by
     team, carrying the RAW Swing Factor as `value` (that is what renders: "8.42")
     and the inverted residual percentile as `percentile` (that is what tiers).

Do NOT publish the residual itself. Document the choice at the return type: the
residual is an intermediate nothing renders, and the teams artifact is this
project's largest payload. Round nothing here -- `buildTeamsArtifact` /
`buildTeamSeasonArtifact` own the single rounding boundary
(`rounding.ts`'s header), and a second rounding pass here would make the site's
number disagree with the harness's.
  </action>

  <verify>
    <automated>npx vitest run packages/harness/metricDirection.test.ts packages/harness/swingMetric.test.ts packages/harness/percentiles.test.ts packages/harness/swingFactor.test.ts</automated>
    <automated>npx tsc --noEmit</automated>
    <automated>grep -rl 'SWING_METRIC_KEY *=' packages/harness apps/web/src | wc -l</automated>
    (must print 1 -- the constant is declared in exactly one file)
  </verify>

  <done>
`metricDirection.ts` and `swingMetric.ts` exist with their test suites green.
The strict `metricDirection` throws on an undeclared name; the lenient
`metricDirectionOrDefault` returns `"higher-is-better"` for one, and the
percentile pass calls the LENIENT form. Every component name across every
registered season resolves through the STRICT accessor, derived from
`BREAKDOWN_REGISTERED_SEASONS`. The
lower-is-better key set is pinned by equality to `{swing}`. The headline test --
a high-rated, high-raw-swing team out-tiering a low-rated, low-raw-swing team --
passes. Every pre-existing `percentiles.test.ts` assertion still passes unchanged.
`swingFactor.ts`'s header no longer claims Swing Factor is not a metric.

Commit, staging ONLY these paths:
`git add packages/harness/swingFactor.ts packages/harness/metricDirection.ts packages/harness/metricDirection.test.ts packages/harness/swingMetric.ts packages/harness/swingMetric.test.ts packages/harness/percentiles.ts packages/harness/percentiles.test.ts`
then `git status` to confirm nothing foreign was absorbed.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Publish the swing metric onto both artifact families</name>

  <files>
packages/harness/publish.ts
packages/harness/publish.test.ts
  </files>

  <read_first>
packages/harness/publish.ts lines 1760-1810 (withPublishedTiers, buildEventTeamsStanding)
packages/harness/publish.ts lines 2480-2640 (the per-(algorithm, season) block and the teamsRows builder)
packages/harness/publish.ts lines 2840-2890 (the per-team artifact call site)
packages/harness/publish.ts lines 940-1030 (TeamsArtifactTeamInput, buildTeamsArtifact)
packages/harness/pageArtifacts.ts lines 1000-1020 (encodeTeamMetricEntry's percentile throw)
packages/harness/publish.test.ts lines 1319-1400 and 1493-1520 (existing buildTeamsArtifact / buildTeamSeasonArtifact suites)
  </read_first>

  <behavior>
Tests first, added to `packages/harness/publish.test.ts`. These are the plan's
LOCAL-ARTIFACT CHECK: they build real artifacts through the real publish-boundary
assembly functions, which Zod-parse before returning, so a shape error throws
rather than passing.

  - `buildTeamsArtifact` given a row whose `metrics` carries a `swing` entry with
    a `tier` and NO `percentile` returns a wire artifact whose `metricKeys`
    includes `SWING_METRIC_KEY` and whose positional slot for it is the
    three-element `[value, null, tier]` form. It does not throw.
  - `buildTeamsArtifact` given a row whose `swing` entry still carries
    `percentile` THROWS -- assert on `encodeTeamMetricEntry`'s message. This is
    the guard that proves the merge happens on the correct side of
    `withPublishedTiers`, and it must be a real test, not a comment.
  - `TeamsArtifactSchema.parse` of that wire artifact decodes the `swing` entry
    back to `{ value, tier }`, so the positional round-trip is lossless for the
    new key exactly as it is for every existing one.
  - `buildTeamSeasonArtifact` given `seasonStats.metrics` carrying a `swing`
    entry with a `percentile` returns an artifact whose
    `seasonStats.metrics.swing.percentile` is that value, and whose top-level
    `swingFactor` field is STILL present and unchanged.
  - Both artifacts round the swing `value` at `ROUNDING_RULE.metric`, exactly
    once, matching the metrics beside it.
  - `withPublishedTiers` applied to a record containing a swing entry with
    percentile 97 yields `tier: "legendary"` and no `percentile` key; with
    percentile 30 it yields no `tier` key at all (Common is omitted, per the
    existing wire-format rule).
  </behavior>

  <action>
**1. Compute the swing metric once per (algorithm, season).** In the
`for (const algorithm of options.algorithms)` block, immediately after
`const swingByTeamForAlgo = layerForAlgo.swingByTeam();`, add a call to
`swingMetricByTeam` using `swingByTeamForAlgo`, the season-final `metricsByTeam`
(for the `total` rating axis) and `teamsThisSeason` (the pool). Bind it to a
single const consumed by both call sites below.

Document, at this call site, why the rating axis is the SEASON-FINAL
`metricsByTeam` rather than `officialMetricsByTeam`: the Swing Factor itself is
season-final -- `layerForAlgo.swingByTeam()` reflects everything played -- so
pairing it with a season-final rating keeps both sides of the residual measured
over the same window. Also state that ONE computation feeds BOTH artifacts, which
is what makes the Teams table and the team page structurally incapable of
disagreeing about a team's swing tier, exactly as the existing top-level
`swingFactor` comment already claims for the value.

**2. Teams row (`teamsRows` builder).** The `metrics` field is currently
`withPublishedTiers(officialMetricsByTeamWithPercentiles[teamKey] ?? {})`. Merge
the team's swing entry into that record BEFORE the `withPublishedTiers` call, so
the pass strips `percentile` and stamps `tier`. Merging after would leave a
`percentile` on the row and `encodeTeamMetricEntry` would throw at publish time.
A team with no swing entry gets nothing merged -- the key stays genuinely absent,
never present-and-undefined.

Note in a comment that the swing entry is season-final while the rest of this
record is the last-official-match snapshot (260904-586 / 260908-wpo). That is not
new -- the top-level `swingFactor` on this same row has always been season-final
-- but now that it sits INSIDE the metrics record beside official-scoped values,
say so plainly rather than leaving a reader to discover it.

**3. Team-season artifact.** Merge the same swing entry into
`seasonStatsMetrics.metrics` before it is passed to `buildTeamSeasonArtifact`.
Here the `percentile` is KEPT -- the per-team artifact is small and carries full
percentiles by design (`TeamMetricSchema.tier`'s own documented size argument),
and the season-header tile derives its tier from it via the existing
`tierForPercentile`.

**4. KEEP the top-level `swingFactor` field on both artifacts, unchanged.**
Do not remove it, do not deprecate it. It is load-bearing in three ways:
`apps/worker/src/scheduled.ts` writes it on every live tick and computes no
percentiles at all (so a live-rebuilt teams row has a swing value and no metric
entry); `apps/web/src/components/event/eventMatchAxis.ts` reads it; and it is the
stale-artifact fallback Task 3 depends on to keep swing rendering between this
commit and the developer's republish. Record all three reasons in a comment at
the publish.ts call site. Do NOT edit `pageArtifacts.ts` at all in this task --
`MetricsRecordSchema` is `z.record(z.string(), TeamMetricSchema)` and already
admits an arbitrary metric key, so the new entry needs no schema change and no
`PAGE_ARTIFACT_SCHEMA_VERSION` bump.

**5. SCOPE FENCE -- do NOT do any of these.** Swing must NOT appear in:
   - the event artifact's team standings (`buildEventTeamsStanding` /
     `withEventPercentiles`) -- D3 limits display to two sites, and an
     event-scoped swing tier is not in scope,
   - `sortedPoolsByMetric`'s pools (do not merge swing into `metricsByTeam`
     itself -- merging there would leak it into event standings and metric
     history via the shared pool),
   - `metricHistory` rows or `HISTORY_PERCENTILE_METRIC_KEYS`,
   - the worker (`apps/worker/src/scheduled.ts`) -- it stays exactly as it is,
     writing the top-level field with no tier.
  </action>

  <verify>
    <automated>npx vitest run packages/harness/publish.test.ts packages/harness/pageArtifacts.test.ts packages/harness/payloadBudget.test.ts</automated>
    <automated>npx tsc --noEmit</automated>
    <automated>git diff --name-only -- packages/harness/pageArtifacts.ts apps/worker/src/scheduled.ts | wc -l</automated>
    (must print 0 -- neither the schema module nor the worker is in this task's scope)
  </verify>

  <done>
`publish.ts` computes the swing metric once per (algorithm, season) and merges it
into both the teams row (tier, no percentile) and the team-season artifact
(percentile). The new `publish.test.ts` cases are green, including the negative
case proving a percentile-bearing swing entry on a teams row throws. The top-level
`swingFactor` field is untouched on both artifacts. `payloadBudget.test.ts` is
still green. No event-artifact, metric-history, or worker file was modified.

Commit, staging ONLY:
`git add packages/harness/publish.ts packages/harness/publish.test.ts`
then `git status`.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Tier boxes on the Swing tile and the Swing column -- and only there</name>

  <files>
apps/web/src/components/teams-table/rowModel.ts
apps/web/src/components/teams-table/rowModel.test.ts
apps/web/src/components/teams-table/columns.tsx
apps/web/src/components/teams-table/columns.test.tsx
apps/web/src/components/team/SeasonHeader.tsx
apps/web/src/components/team/SeasonHeader.test.tsx
  </files>

  <read_first>
.claude/skills/sketch-findings-sigmascout/SKILL.md
.claude/skills/sketch-findings-sigmascout/references/colour-and-tiers.md
apps/web/src/lib/tiers.ts (the whole file, 69 lines)
apps/web/src/components/MetricValue.tsx (lines 1-130 -- the tier prop contract and the swingScore prop)
apps/web/src/components/teams-table/rowModel.ts (lines 60-150)
apps/web/src/components/teams-table/columns.tsx (lines 370-445 -- the metric cell's tier coalesce, and the swingColumn)
apps/web/src/components/team/SeasonHeader.tsx (lines 60-80 and 150-165 and 265-287)
  </read_first>

  <behavior>
Tests first.

`rowModel.test.ts`:
  - A published row whose `metrics` carries `{ swing: { value: 8.42, tier: "legendary" } }`
    produces `swingScore === 8.42` and `swingTier === "legendary"`.
  - A published row whose `metrics` carries `{ swing: { value: 8.42 } }` (Common,
    tier omitted on the wire by design) produces `swingScore === 8.42` and
    `swingTier === "common"` -- the tier IS known here, it is just the omitted one.
  - A STALE row carrying only the top-level `swingFactor` and NO `swing` metric
    entry produces `swingScore` from that field and `swingTier === undefined`.
    This case must not render a ring at all; assert `undefined`, not `"common"`.
  - A row with neither produces `swingScore === undefined` and
    `swingTier === undefined`.
  - Sorting by the swing column still orders by VALUE ascending/descending
    exactly as before -- the tier does not reorder anything. Pin this explicitly;
    it is the one behaviour a direction change could plausibly break by accident.

`columns.test.tsx`:
  - The swing cell for a Legendary row carries the legendary tier class.
  - The swing cell for a stale row (value, no tier) renders the value with NO
    `.metric-tier` wrapper class at all.
  - An absent swing renders blank, not `0.00` -- the existing behaviour, re-pinned.

`SeasonHeader.test.tsx`:
  - An artifact whose `seasonStats.metrics.swing` carries `percentile: 97`
    renders the Swing tile with the legendary tier class.
  - An artifact whose `seasonStats.metrics.swing` carries `percentile: 12`
    renders the Swing tile with the common (hairline ring) tier class.
  - A STALE artifact carrying only the top-level `swingFactor` renders the Swing
    tile with the value and NO tier class.
  - The ribbon's `showSwingFactor` toggle still hides the tile entirely when off.
  - `MetricValue`'s `± X` superscript render path is NOT given a tier by any of
    these changes -- assert no tier class appears on a metric superscript.
  </behavior>

  <action>
Load the sketch-findings skill and `references/colour-and-tiers.md` BEFORE
touching any file here; the project's own instructions require it for UI work.
The tier cuts, the palette, and the Common-hairline-ring rule are all decided
there and must not be re-derived. **Nothing in this task changes a colour, a cut,
or a class name.** The only change is WHICH cells get a tier and WHERE that tier
comes from.

**1. `rowModel.ts`.** Import `SWING_METRIC_KEY` from
`packages/harness/swingFactor.js` (the same deep-relative-path-with-.js
convention this file already uses for `teamRanks.js`). Add `swingTier?: Tier` to
`TeamRow`. In `buildTeamRows`, read the published `swing` metric entry from the
row's metrics record:
  - entry present -> `swingScore = entry.value`, `swingTier = entry.tier ?? "common"`.
    The coalesce is correct HERE because the entry's presence proves the pipeline
    ranked this team, and Common is omitted from the wire purely for size (the
    same argument `columns.tsx`'s existing metric cells already make in place).
  - entry absent -> fall back to the top-level `swingFactor` for the value, and
    leave `swingTier` UNDEFINED. Do NOT coalesce to Common here: the two reasons
    the entry can be absent are a pre-republish artifact and a live worker
    rebuild, and in neither case does the pipeline know this team's tier. A
    Common ring would be a positive false claim.
Write that two-branch distinction out as a comment; it is the single most
"fixable-back-to-wrong" line in this task.
Also remove the `(team as { swingFactor?: number })` cast if the published entry
path makes it unnecessary -- but keep reading the top-level field for the
fallback branch.

**2. `columns.tsx`.** Render the swing cell through `MetricValue` so it gets the
identical `.metric-tier` box, padding and `toFixed(2)` every other tiered cell on
the site gets -- do not hand-roll a second box. Read the value from the existing
`swingScore` accessor and the tier from `info.row.original.swingTier`. Pass the
tier straight through, including `undefined` (which `MetricValue` already
contracts to mean "no wrapper class at all"). Do NOT apply the `?? "common"`
coalesce the metric columns use -- `rowModel.ts` already made that decision
correctly per-branch above, and re-coalescing here would undo it for stale rows.
Keep the accessor id `swingScore` and the header `"Swing"` exactly as they are, so
sorting, the `±` ribbon toggle, and the column width are all unchanged.
Update the `swingColumn` doc comment to say it now carries a tier and that lower
swing earns the higher tier.

**3. `SeasonHeader.tsx`.** Read the swing metric from the resolved metrics record
under `SWING_METRIC_KEY` rather than only from `artifact.swingFactor`, keeping the
top-level field as the stale-artifact fallback for the VALUE. Render
`SwingScoreTile` through `MetricValue` with `tier={tierForPercentile(entry?.percentile)}`
-- reusing the existing client tier function, which delegates its cuts to
`publishedTierForPercentile`, so the single-source property survives this change
untouched. When only the fallback value exists, pass no tier.

**DELETE the now-false comment** at the `<SwingScoreTile />` call site: it
currently reads "deliberately unboxed by tier: a consistency estimate has no
percentile pool behind it." That is exactly what this task changed. Replace it
with one sentence saying the tile IS tier-boxed, that the percentile behind it is
the team's residual against an expected-swing curve at its own rating (so a strong
robot is not automatically high-swing), and that the direction is inverted at the
pipeline so LOW swing earns the high tier.

Also revisit the comment block above `const swingScore = ...` (around line 150),
which asserts Swing Score "is deliberately unboxed" reasoning by implication --
make sure nothing left in that file still claims swing carries no tier.

**4. Do NOT touch `MetricValue.tsx`, `tiers.ts`, `theme.css`, or any other
render site (D3).** In particular, the `± X` superscript path stays exactly as
it is. If a change appears to require editing `MetricValue.tsx`, stop and
re-read D3 -- the answer is to pass a prop, not to widen that component.
  </action>

  <verify>
    <automated>npx vitest run apps/web/src/components/teams-table apps/web/src/components/team/SeasonHeader.test.tsx apps/web/src/lib/tiers.test.ts</automated>
    <automated>npx tsc --noEmit -p apps/web/tsconfig.json</automated>
    <automated>git diff --name-only -- apps/web/src/components/MetricValue.tsx apps/web/src/lib/tiers.ts apps/web/src/styles/theme.css | wc -l</automated>
  </verify>

  <done>
The Swing tile and the Swing column both render a rarity tier box, sourced from
the pipeline's published tier/percentile, with lower swing earning the higher
tier. A stale, pre-republish artifact still shows its swing VALUE with no ring.
`MetricValue.tsx`, `tiers.ts` and `theme.css` are untouched (the third verify
command prints `0`). No comment anywhere in `SeasonHeader.tsx` still claims the
Swing tile is unboxed.

Commit, staging ONLY:
`git add apps/web/src/components/teams-table/rowModel.ts apps/web/src/components/teams-table/rowModel.test.ts apps/web/src/components/teams-table/columns.tsx apps/web/src/components/teams-table/columns.test.tsx apps/web/src/components/team/SeasonHeader.tsx apps/web/src/components/team/SeasonHeader.test.tsx`
then `git status`.
  </done>
</task>

</tasks>

<verification>

Run from the REPO ROOT, after the final commit. Judge by printed output, never by
exit code alone, and never wrap these in `timeout`.

1. `npx vitest run` -- the full 167-file suite, green. If the file count printed
   is materially below 167, you ran it from the wrong directory; rerun from the
   repo root.
2. `npx tsc --noEmit` -- clean.
3. `npx tsc --noEmit -p apps/web/tsconfig.json` -- clean. Root `tsc` returns clean
   with real web errors present, so this second run is not redundant.
4. `git status` -- confirm the working tree still carries the OTHER session's
   unrelated modifications untouched and unstaged
   (`EventMatchTable.tsx`, `MatchTable.tsx`, `theme.css`, `empiricalMoments.ts`,
   `empiricalMoments.test.ts`), and that no commit absorbed them.
5. `git log --oneline -3` and, for each commit, `git show --stat --oneline <sha>`
   -- confirm each commit's file list matches exactly the paths its task named.

LOCAL-ARTIFACT CHECK: this is the new `publish.test.ts` suite in Task 2. It builds
real teams and team-season artifacts through the real `buildTeamsArtifact` /
`buildTeamSeasonArtifact` boundary functions, which Zod-parse before returning, so
a wrong shape throws rather than passing. That is the strongest artifact-level
verification available without network access, and it is sufficient here.

DO NOT attempt a `pnpm publish:*` dry run as a verification step. Executor
subagents are network-sandboxed and the command will be denied regardless of the
`--dry-run` flag.

</verification>

<developer_followup>

Not the executor's work. Record these in the SUMMARY so they are not lost.

1. **The republish (D4).** Nothing in this change renders on the live site until
   seasons are republished to R2. Run `pnpm publish:seasons` from the main
   context. Every page keeps rendering its swing VALUE in the meantime, via the
   top-level `swingFactor` fallback deliberately preserved in Tasks 2 and 3 --
   only the tier ring is missing until then.
2. **`docs/publish-budget.md` is a manual transcription step.** `publish:seasons`
   prints its size summary but does not write the doc. The `swing` key adds one
   positional slot to every teams row and one metric entry to every team-season
   artifact. Transcribe the new numbers after the republish or
   `payloadBudget.test.ts` will start failing against a stale committed budget.
3. **Visual check after the republish.** Per the recorded recipe, a local visual
   pass needs `VITE_ARTIFACT_ORIGIN=local` to activate the `/v1` proxy (R2 CORS
   blocks localhost) and a fresh port per restart. Confirm on `/teams` that the
   most consistent robots -- not merely the weakest -- are the gold ones, and that
   an elite team with an honest, level-appropriate swing is not automatically grey.

</developer_followup>

<success_criteria>
- Swing Factor publishes as a `swing` metric entry on every algorithm's teams row
  (value + tier) and team-season artifact (value + percentile).
- The percentile is the team's residual against an expected-swing curve fitted
  over the season pool, inverted so lower swing ranks higher (D1 + D2).
- A high-rated, high-raw-swing team can out-tier a low-rated, low-raw-swing team,
  proved by a named unit test.
- Direction is a declared per-metric fact exposed as a strict accessor (throws;
  used by CI) and a lenient one (defaults to higher-is-better; used by the publish
  path), not a swing special case (D2). Publish-time behaviour for an unknown
  metric name is unchanged from today.
- Tier boxes render on the SeasonHeader Swing tile and the teams-table Swing
  column, and nowhere else (D3).
- Full root suite green; both typecheck projects clean.
- No republish attempted (D4); every commit staged by explicit path (D5).
</success_criteria>

<output>
Create `.planning/quick/260909-tgf-make-swing-factor-a-first-class-metric-w/260909-tgf-SUMMARY.md` when done.

Note: the Write tool is blocked for subagents on SUMMARY.md. Return the summary
text in your final message and let the orchestrator write it.
</output>
