---
quick_id: 260920-qzf
phase: quick
plan: 01
type: execute
wave: 1
depends_on: []
autonomous: false
requirements:
  - A-cuts-published-in-event-artifact
  - B-cuts-reproduce-published-tier-exactly
  - C-cuts-survive-a-live-merge
  - D-client-falls-back-to-cuts
  - E-no-version-bump-no-worker-cost-no-visual-change
files_modified:
  - packages/harness/pageArtifacts.ts
  - packages/harness/tierCuts.ts
  - packages/harness/tierCuts.test.ts
  - packages/harness/percentiles.ts
  - packages/harness/publish.ts
  - apps/worker/src/artifactMerge.ts
  - apps/worker/test/scheduled.mergePreservation.test.ts
  - apps/web/src/lib/tiers.ts
  - apps/web/src/lib/tiers.test.ts
  - apps/web/src/components/event/BreakdownTab.tsx
  - apps/web/src/components/event/InsightsTab.tsx
  - apps/web/src/components/event/AlliancesTab.tsx
  - apps/web/src/components/match/MatchRobotGrid.tsx
  - apps/web/src/components/match/MatchRobotGrid.test.tsx
  - apps/web/src/components/team/EventSection.tsx
  - apps/web/src/components/team/EventSection.test.tsx
  - apps/web/src/components/team/EventSectionList.tsx
  - apps/web/src/components/team/OverviewTab.tsx
  - apps/web/src/components/team/useLiveTeamSeason.ts
  - apps/web/src/routes/match.$matchKey.tsx
  - apps/web/src/routes/team.$teamNumber.tsx
  - .planning/todos/pending/live-merges-drop-percentiles.md
estimate:
  tokens: 130000
  raw_tokens: 85000
  tasks: 3
  confidence: low
must_haves:
  truths:
    - "For every metric name the season ranking pool covers, and for every value on the 2-decimal display grid, the tier derived from the published cuts equals the tier derived from that value's published percentile — exactly, including at each band boundary and on both sides of it."
    - "A team whose event-standings row was rewritten by a live tick renders the same rarity tier it rendered before that tick, on Breakdown, Insights and the Alliances pick pills."
    - "A robot-grid cell and a team-page event tile derived from a `live` block row render a tier, where before this task they rendered none."
    - "No `sigma` cut is ever published, because Sigma's published percentile is a within-window detrended rank, not a function of (value, season pool)."
    - "The live tick's CPU and subrequest cost is unchanged: it neither computes, reads, nor writes the cuts block, it only carries a key it already carries."
    - "No published number changes, so no algorithm version moves and `PAGE_ARTIFACT_SCHEMA_VERSION` does not move."
    - "No page makes a new network request and no palette, spacing or box style changes."
  artifacts:
    - packages/harness/tierCuts.ts
    - packages/harness/tierCuts.test.ts
    - "`tierCuts` on `EventArtifactSchema` in packages/harness/pageArtifacts.ts"
    - "`buildTierCutsFromPools` in packages/harness/percentiles.ts"
  key_links:
    - "`buildTierCutsFromPools(rankingPools)` is fed the SAME `rankingPools` map that `withEventPercentiles` and `withHistoryPercentiles` rank against — one pool, one helper, so the cuts cannot describe a different pool than the percentiles beside them."
    - "`tierCuts` is declared on `EventArtifactSchema`, which is what stops `writeArtifactObject`'s `SCHEMA_BY_PAGE.event` parse from stripping it on the Worker write — the exact inverse of the `live` key's ephemerality mechanism."
    - "`mergeEventArtifact`'s spread-then-override carries `tierCuts` through `...carriedFromExisting`: it is publisher-owned, so it must NOT be added to the override list and must NOT be destructured out."
    - "The event page, the match page and the team page all already hold the event artifact, so the block reaches every affected surface with zero added fetches."
---

# 260920-qzf: tier cut points in event artifacts so live-folded rows keep their rarity tier

## The defect (diagnosed, not to be re-investigated)

When the live Worker rewrites an event artifact, `touchedEventTeamMetrics`
(`apps/worker/src/artifactMerge.ts`) writes each touched team's metrics through
`roundTeamMetricRecord` and carries forward only the prior `sigma` entry. Every other metric loses
its `percentile`, so `tierForPercentile(entry?.percentile)` returns `undefined` and the row renders
with no rarity tier until the next offline publish. On 2026-09-20 this hit all 42 teams at Chezy
Champs at once. The `live` block rows the team and match pages derive from have the same gap by
construction — `EventLiveRowSchema` deliberately carries values only.

Computing percentiles inside the tick needs the season pool, and that is blocked behind
`rp-fold-exceeds-worker-cpu-budget`. This task is the unblocked alternative: ship the *answer*
instead of the *pool*.

## The design

A published tier is `publishedTierForPercentile(goodnessPercentileAgainstPools(pool, name, value))`.
Unroll that:

- `roundMetric` is monotone non-decreasing.
- `percentileAgainstSortedPool` is non-decreasing in its (rounded) query.
- `goodnessPercentile` is either the identity or `100 - p`.
- `publishedTierForPercentile` is non-decreasing in `p` (cuts at 50 / 75 / 95, each half-open on the
  low side, Legendary closed at 100).

So the tier is a **monotone step function of the rounded value**, with at most three steps. Three
boundary values reproduce it exactly. The publisher already builds the pool once per
`(algorithm, season)`; it emits those three values per metric name into each event artifact, and the
client applies them whenever a metric entry has a value but no percentile.

### Block name and shape

`tierCuts`, an optional key on `EventArtifactSchema`:

```jsonc
"tierCuts": {
  "total":       { "cuts": [31.17, 52.4, 88.05] },
  "phaseAuto":   { "cuts": [7.2, 12.86, 24.1] },
  "autoCoral":   { "cuts": [...] }
  // ... one entry per metric name in the season ranking pool
}
```

- `cuts` is `[rare, epic, legendary]` — the smallest grid value at which the tier reaches that band.
- Evaluation: `tier(v) >= T` iff `roundMetric(v) >= cuts[T]`. Rounding the query is what makes the
  rule exact for any real input, because the reference rounds it too.
- `lower: true` is an OPTIONAL marker that flips the comparison to `<=` and makes `cuts` descending,
  for a lower-is-better metric. **No entry carries it today** and none can (see "sigma" below), so it
  costs zero bytes in production.

Why a wire-format marker rather than having the client call `metricDirectionOrDefault`: that
accessor's direction table is built from `BREAKDOWN_REGISTERED_SEASONS` x `componentMapForSeason`,
so importing it would pull `packages/core/algorithms/breakdown/*` into the browser bundle for a fact
the publisher already knows. A self-describing block keeps the client's dependency at
`roundMetric` alone, and makes a future silent inversion impossible.

### Which metrics get cuts, and why sigma cannot

The cuts are built from exactly `rankingPools` — the same
`sortedPoolsByMetric(officialMetricsByTeam, teamsThisSeason)` map every published percentile on the
page ranks against. `sigma` is **structurally absent** from that map: `withHistorySigma` is applied
only at the team-season build, deliberately after the rows that feed the pools
(`publish.ts` ~line 217-233 states this). So no `sigma` cut can be emitted even by accident.

That absence is load-bearing, not incidental. Since 260917-jzh the published Sigma percentile is a
**detrended mid-rank within that team's own rating window** (`packages/harness/sigmaMetric.ts`), not
a function of (value, season pool). A pool-derived sigma cut would paint a confidently wrong tier.
Pin the absence with a direct assertion, not by iterating a name list.

Sigma is unaffected either way:

- **Event standings:** `touchedEventTeamMetrics` already carries the prior published `sigma` entry —
  percentile included — through a live tick, so its tier survives today and keeps surviving.
- **`live` block rows:** sigma rides as an ordinary `metricKeys` member with a fresh value and no
  percentile, and renders untiered. That is the existing deliberate behaviour (STATE #201: "the Sigma
  half untiered because a per-match row carries no percentile"), and it stays.

### Where the block lives: the event artifact, and nowhere else

- **Event page** (Breakdown / Insights / Alliances) reads the event artifact directly.
- **Team page event tiles** and the **match page robot grid** derive their rows from the `live` block
  **of that same event artifact**, and both already hold it —
  `useLiveTeamSeason`'s `eventArtifactsByKey`, and `match.$matchKey.tsx`'s `data`. Zero new fetches,
  which is the constraint.
- **Team artifact surfaces** (`SeasonHeader`, `RankCards`, `seasonStats`) need nothing: the tick
  stopped writing team artifacts entirely in 260917-jr4 / 260918-16t, so their percentiles are never
  dropped any more.

### Size cost, against the committed budget

Per entry: name (~12 B) + `{"cuts":[a,b,c]}` (~26 B) ≈ **38 B**; ~14 to 30 metric names per
`(algorithm, season)` ⇒ **~0.5 to 1.2 KB per event artifact**, uncompressed, before transfer
compression.

From `docs/publish-budget.md`'s committed block (generation `e5cf1304`): the largest event body is
**228,865 B** (`v1/event/2016micmp/spr@6.0.0+baseline.json`) against the **350,000 B** `event`
ceiling — **121,135 B of headroom**. The block spends under **1%** of it. The
`EVENT_LIVE_BLOCK_TRIM_THRESHOLD_BYTES` worst-case arithmetic (228,971 + 79,530 = 308,501 B) gains
~1 KB and stays above the 300,000 B trim threshold exactly as it already does, which is what that
backstop is for.

**No ceiling moves and no budget number is hand-edited.** `PAGE_BUDGET_MAX_BYTES` is untouched, and
the `budget` block in `docs/publish-budget.md` is rewritten by the owed `pnpm publish:seasons
--write-budget` run after this lands.

### Why no algorithm version bump

The owner's rule is that a changed published **number** must ship under a new version. This task
changes no number: every `value`, `spread`, `percentile`, `tier`, prediction, score and pmf in every
artifact is byte-identical. It adds one derived key whose contents are computed from the same pool
that already produced the percentiles sitting beside it. So `opr`/`epa`/`spr` versions stay put.
`PAGE_ARTIFACT_SCHEMA_VERSION` likewise does not move — an additive optional key on one page kind,
matching that file's own stated precedent for `name`/`startDate`/`location`/`week`/`alliances`/
`allianceTeams`/`rpOutcomeRp`.

### Worker: carry-forward, verified not assumed

`mergeEventArtifact` is spread-then-override with **no allow-list**, and `artifactShapeCheck.ts`
returns the read body without stripping unknown keys. So `tierCuts` rides `...carriedFromExisting`
unchanged, keeping its original key position. `writeArtifactObject`'s `SCHEMA_BY_PAGE.event` is
`LiveEventArtifactSchema`, which extends `EventArtifactSchema` — declaring `tierCuts` there is
precisely what stops zod stripping it on the Worker write. The whole design rests on this, so Task 2
pins it with a Worker test rather than trusting the reading.

**The two paths where the block IS lost, named here rather than discovered later:**

1. **Bootstrap write** (`existing === undefined`): an event with no published artifact at all. The
   Worker invents no cuts, the artifact carries none, and those rows render untiered exactly as they
   do today — until the first offline publish of that event. This is the honest outcome; the Worker
   has no season pool, which is the original CPU gate.
2. **`writeArtifactWithBootstrapRetry`** degrading a corrupt artifact to a bootstrap merge — same
   outcome, same reason.

Both are strictly no worse than today's behaviour, never worse than it.

### What this does NOT fix, and must not

- The displayed **percentile number** (the team page World rank card, the Alliances tab's
  approximate combined percentile) stays absent for a live-folded row. Do not synthesize one.
- `allianceTierApproximation.ts` keeps requiring a published percentile for its interpolation points,
  so the **combined** alliance estimate thins during live folding. Unchanged, deliberately: it is an
  estimate of a percentile number, and approximating percentile numbers is out of scope. The
  individual pick pills at `AlliancesTab.tsx` ~449/489 DO get the fallback.

## Concurrency constraints — READ BEFORE EDITING

Another agent is editing this same checkout right now.

- `packages/harness/publish.ts` and `packages/harness/publish.test.ts` **have uncommitted in-flight
  edits** around the seed-writing section (~lines 2380-2430). **Do not touch that region, and do not
  touch `publish.test.ts` at all** — Task 1's publisher assertion goes in the new `tierCuts.test.ts`,
  calling `buildEventArtifact` directly.
- Re-read `publish.ts` immediately before each edit; line numbers in this plan are from HEAD and may
  have moved.
- A second planned task (260920-qgg) will edit `packages/core/algorithms/breakdown/*`, `spr.ts` and
  `epa.ts`. This task touches none of those.
- **Stage by explicit path only.** Never `git add -A` or `git add .` — commit `f0c7af48` absorbed
  another session's edits that way.
- Never read `.env`.

## Known environment traps

- Run vitest **from the repo root** (`npx vitest run <paths>`), never from `apps/web` — the root runs
  167 files, `apps/web` runs 77, and an 8-day red CI once hid in that gap.
- Judge test results by the **printed counts**, not by exit code; never wrap a pnpm script in
  `timeout`.
- Root `tsc --noEmit` misses `apps/web`. Run the web tsconfig too, and expect ~45 spurious errors
  there until `vite build` has generated `routeTree.gen.ts`.
- `cn()` (tailwind-merge) eats `text-role-*` classes beside `text-[var(...)]`. This task adds no
  classes, so if a class string changes at all, that is a defect.
- The executor has no network. Do not attempt a publish, a deploy or a live fetch.

## Owed after this lands (orchestrator, not executor)

1. `pnpm publish:seasons ... --write-budget` so artifacts actually carry the block, then commit the
   rewritten `docs/publish-budget.md`.
2. Push to deploy Pages, then `gh run list` to confirm CI and the deploy workflow are green.
3. Rerun the live-only Playwright e2e specs against sigmascout.org.
4. A real screenshot check of a live-folded event page.

<tasks>

<task type="tracer" tdd="true">
  <name>Task 1: cuts are built, published, and proven to reproduce the published tier exactly</name>
  <files>packages/harness/tierCuts.ts, packages/harness/tierCuts.test.ts, packages/harness/pageArtifacts.ts, packages/harness/percentiles.ts, packages/harness/publish.ts</files>
  <behavior>
    - Sweep exactness, higher-is-better: for a pool with ties, duplicates, negatives and a tie sitting
      exactly on a band boundary, every distinct rounded pool value AND one grid step either side of
      each of them yields `tierFromCuts(entry, v)` equal to
      `publishedTierForPercentile(goodnessPercentileAgainstPools(pool, name, v))`, treating the
      published `undefined` (Common) and the client's Common as the same outcome.
    - Sweep exactness, lower-is-better: the same sweep with `metricDirectionOrDefault` returning
      lower-is-better (use `SIGMA_METRIC_KEY` purely as a direction fixture), asserting the built
      entry carries `lower: true` and that the `<=` comparison reproduces the reference.
    - Out-of-pool range: a value far below the pool minimum and far above the pool maximum both agree
      with the reference, in both directions.
    - A pool of one value, and a pool where every value is identical, both build and both agree.
    - A real-shaped pool: build cuts from the pool of a several-hundred-team fixture and sweep it the
      same way.
    - The map built from a real `rankingPools` has no `sigma` entry (assert the key's absence
      directly, on the built object).
    - `buildEventArtifact` with cuts supplied emits `tierCuts`; with none supplied it emits no
      `tierCuts` key at all.
    - `EventArtifactSchema` parses an artifact with a malformed `tierCuts` by dropping the block, not
      by failing the artifact.
    - An old artifact with no `tierCuts` still parses.
  </behavior>
  <action>
Write the tests in `packages/harness/tierCuts.test.ts` FIRST and watch them fail, then implement.

**`packages/harness/tierCuts.ts` (new) — the evaluator, browser and Worker safe.** It may import
`roundMetric` from `./rounding.js` and types from `./pageArtifacts.js` and NOTHING ELSE. It must never
gain a runtime dependency on `zod`, on `metricDirection.js`, or on anything under
`packages/core/algorithms/breakdown/`, because this module is bundled into the browser. Export
`tierFromCuts(entry: EventTierCutEntry | undefined, value: number | undefined): Tier | undefined`
returning `undefined` when either argument is absent, and otherwise comparing `roundMetric(value)`
against `entry.cuts` with `>=` — or `<=` when `entry.lower` is `true` — from Legendary down, falling
through to `"common"`. Name the four tiers with the same literal union
`apps/web/src/lib/tiers.ts` exports; declare the union here and have `tiers.ts` re-export it rather
than keeping two copies. Document in the file header that rounding the query is what makes the rule
exact, and that this is the one place the cut semantics are stated.

**`packages/harness/pageArtifacts.ts` — the schema.** Declare `EventTierCutEntrySchema` as
`z.object({ cuts: z.tuple([z.number(), z.number(), z.number()]), lower: z.literal(true).optional() })`
and `EventTierCutsSchema` as a `z.record(z.string(), ...)` over it. Export the inferred types. Add
`tierCuts: EventTierCutsSchema.optional().catch(undefined)` to `EventArtifactSchema`, positioned
after `rpOutcomeRp` and BEFORE `state`, so the two large blocks stay at the end of the body. Write a
doc comment that states: the three cuts are `[rare, epic, legendary]`; the evaluation rule and where
it lives; that `lower` is omitted rather than written `false`, following this file's own
omitted-for-Common precedent; that `.catch(undefined)` matches `state`'s rule so a one-key problem
never becomes a whole-artifact failure; that declaring the key HERE rather than only on
`LiveEventArtifactSchema` is what keeps the Worker's write-side parse from stripping it, which is the
exact inverse of the `live` key's ephemerality mechanism; and that
`PAGE_ARTIFACT_SCHEMA_VERSION` is deliberately not bumped because this is an additive optional key
matching the precedent the schema header already names.

**`packages/harness/percentiles.ts` — the builder.** Export
`buildTierCutsFromPools(sortedPools: ReadonlyMap<string, readonly number[]>): EventTierCuts`. For each
metric name in the map, resolve the direction with `metricDirectionOrDefault` (the lenient accessor,
for the reason that file's header already gives), then find the three boundaries by evaluating the
reference — `publishedTierForPercentile(goodnessPercentileAgainstPools(...))` — over a candidate set
and taking the extremal candidate for each band. Build the candidate set as: every distinct pool
value, plus one grid step below and one grid step above each of them, plus one step beyond each end
of the pool. Derive a neighbouring grid value as `roundMetric(v + 0.01)` / `roundMetric(v - 0.01)`
and never as bare `v + 0.01`: `0.07 + 0.01` evaluates to `0.08000000000000002`, which is not the
double the publisher and the Worker produce, and a cut off the grid would misclassify a value sitting
on the boundary. Sort the deduped candidates ascending, evaluate the reference at each, and take the
first candidate reaching each band for higher-is-better or the last for lower-is-better. Throw a
named error if a band is unreachable — with a non-empty pool all three are always reachable, since
the region beyond the favourable end always reads 100, so a throw there is a defect signal and never
an expected path, exactly as `EmptyPoolError` is. Document the monotonicity argument and the
candidate-set completeness argument in the doc comment: the percentile is constant on the open
interval between consecutive distinct pool values, so the tier can only change at a pool value or at
the first grid step past one. State that the map's key set is the pool's key set, so `sigma` is
excluded structurally rather than by a name list, and say why that matters, citing
`sigmaMetric.ts`'s within-window rank.

**`packages/harness/publish.ts` — wiring, minimal diff, three touch points.** Re-read the file
first; another agent is editing it. (1) Add an optional `tierCuts` field to
`BuildEventArtifactParams` near line 363. (2) In `buildEventArtifact` near line 499, spread the key
into the returned object only when it is defined, so an absent input adds no key — the same
`...(x !== undefined ? { x } : {})` shape the builder already uses for its other optional keys, and
positioned to match the schema order. (3) Beside the existing `const rankingPools = ...` near line
2044, hoist `const eventTierCuts = buildTierCutsFromPools(rankingPools);` — built ONCE per
`(algorithm, season)`, never per event — and pass it at the `buildEventArtifact` call near line 2220.
Do not reformat anything, do not touch any line at or after ~2350, and do not open `publish.test.ts`.
  </action>
  <verify>
    <automated>npx vitest run packages/harness/tierCuts.test.ts packages/harness/percentiles.test.ts packages/harness/pageArtifacts.test.ts</automated>
  </verify>
  <done>The exactness sweep passes for both directions over every listed pool shape; the built map has no `sigma` key; `buildEventArtifact` emits `tierCuts` when given cuts and omits the key otherwise; a malformed block degrades to absent rather than failing the artifact parse; `publish.test.ts` is unmodified.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: pin that the cuts block survives a live merge, and say so in the merge's own docs</name>
  <files>apps/worker/test/scheduled.mergePreservation.test.ts, apps/worker/src/artifactMerge.ts</files>
  <behavior>
    - `mergeEventArtifact` given an `existing` artifact carrying `tierCuts` returns an output whose
      `tierCuts` is deep-equal to the input's, for a tick that touches teams and folds a match.
    - The same holds after the output goes through the write-side parse the Worker actually uses
      (`LiveEventArtifactSchema`), which is the step that would strip an undeclared key — assert on
      the PARSED output, not only on the raw merge return.
    - A merge whose `existing` is `undefined` (the bootstrap path) returns no `tierCuts` key at all,
      rather than an empty object or a fabricated one.
    - An `existing` with no `tierCuts` still merges and still returns no such key.
  </behavior>
  <action>
Add the cases to `apps/worker/test/scheduled.mergePreservation.test.ts`, which already exists to pin
exactly this class of carry-forward. Reuse that file's existing fixture builders rather than
introducing a second event-artifact fixture shape.

**No Worker code change is required and none should be made to the merge logic.** `tierCuts` must
NOT be added to `mergeEventArtifact`'s explicit override list and must NOT be destructured out of
`existing` alongside `state` and `live` — it is publisher-owned, so it rides `...carriedFromExisting`
and keeps its original key position. Doing either would delete it on the first tick.

Two doc-comment edits only, in `apps/worker/src/artifactMerge.ts`: extend `mergeEventArtifact`'s
carry-forward trade-off paragraph to name `tierCuts` alongside the Sigma entry and the teams-row
tier/record as a key that is stale-but-true between republishes, and note that a bootstrap merge
carries none because the Worker has no season pool. Then rewrite `touchedEventTeamMetrics`'
"Known limitation" paragraph: a touched team's other metrics still lose their `percentile` — the
Worker computes none and that is the CPU gate — but the tier no longer disappears with it, because
the client re-derives it from the artifact's `tierCuts`. Say plainly that the percentile NUMBER stays
absent and is not approximated.
  </action>
  <verify>
    <automated>npx vitest run apps/worker/test/scheduled.mergePreservation.test.ts apps/worker/test/artifactShapeCheck.test.ts apps/worker/test/artifactWriter.test.ts</automated>
  </verify>
  <done>The merge preserves `tierCuts` byte-for-byte through the write-side parse; the bootstrap path returns no such key; the merge's own doc comments name the key and state the bootstrap loss; `mergeEventArtifact`'s override list and destructuring are unchanged.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: the client derives a tier from cuts whenever a percentile is missing</name>
  <files>apps/web/src/lib/tiers.ts, apps/web/src/lib/tiers.test.ts, apps/web/src/components/event/BreakdownTab.tsx, apps/web/src/components/event/InsightsTab.tsx, apps/web/src/components/event/AlliancesTab.tsx, apps/web/src/components/match/MatchRobotGrid.tsx, apps/web/src/components/match/MatchRobotGrid.test.tsx, apps/web/src/components/team/EventSection.tsx, apps/web/src/components/team/EventSection.test.tsx, apps/web/src/components/team/EventSectionList.tsx, apps/web/src/components/team/OverviewTab.tsx, apps/web/src/components/team/useLiveTeamSeason.ts, apps/web/src/routes/match.$matchKey.tsx, apps/web/src/routes/team.$teamNumber.tsx, .planning/todos/pending/live-merges-drop-percentiles.md</files>
  <behavior>
    - A metric entry WITH a percentile resolves to the identical tier whether or not cuts are present,
      and resolves to that tier even when the cuts would disagree — the published percentile always
      wins.
    - A metric entry with a value and NO percentile resolves to the tier the cuts give.
    - A metric entry with a value, no percentile and no cut entry for that name resolves to no tier.
    - An absent metric entry resolves to no tier, with or without cuts.
    - Component: a robot-grid cell whose entry has a value and no percentile renders the tier box the
      cuts imply; the same cell with no cuts renders no tier box.
    - Component: an event-section tile whose entry has a value and no percentile renders its tier
      from cuts.
    - Render parity: for an entry that DOES carry a percentile, the rendered markup is unchanged from
      before this task.
  </behavior>
  <action>
Extend `apps/web/src/lib/tiers.ts` with one exported resolver and leave `tierForPercentile` exactly as
it is, so every existing caller keeps compiling and rendering identically. The resolver takes the
metric entry, its metric NAME, and the event artifact's `tierCuts` (all optional), and returns
`tierForPercentile(entry.percentile)` when a percentile is present, else `tierFromCuts` against the
entry for that name, else `undefined`. Document that the published percentile always wins, that a
missing cut entry means no tier rather than a guess, and that the percentile NUMBER is never
synthesized from cuts. Re-export the `Tier` union from `packages/harness/tierCuts.js` rather than
keeping a second copy of the literals.

Wire the five call sites named in the defect report, each swapping
`tierForPercentile(entry?.percentile)` for the new resolver and passing the metric name it is already
rendering. Change nothing else about those call sites — no class strings, no element structure, no
conditional rendering. A changed class string is a defect, not a refactor.

- `BreakdownTab.tsx` (~336-343), `InsightsTab.tsx` (~272, ~292), `AlliancesTab.tsx` (~449, ~489):
  read `tierCuts` off the event artifact these components already receive. The `sigma` half keeps
  using `tierForPercentile(sigmaEntry.percentile)` — the merge carries that percentile forward and no
  sigma cut exists, so routing it through the resolver would be a no-op at best and a wrong tier the
  day a sigma cut ever appeared.
- `MatchRobotGrid.tsx` (~147, ~152): add an optional `tierCuts` prop to `MatchRobotGridProps` and pass
  `data?.tierCuts` from `match.$matchKey.tsx` (~227), where `data` is the event artifact the page
  already holds for its `live` rows. The component stays a pure function of its props.
- `EventSection.tsx` (~146, ~174): add an optional `tierCuts` prop; drill it from
  `EventSectionList.tsx` (~69) as a per-event lookup, from `OverviewTab.tsx` (~55), from
  `team.$teamNumber.tsx` (~160). Source it in `useLiveTeamSeason.ts` (~95) from the SAME
  `eventArtifactsByKey` map it already reads for `extendMetricHistory`, returned as one more field on
  the `live` object — build it with the same memo discipline that file already uses so an unchanged
  artifact set produces a stable reference and no consumer re-renders.

Add the resolver unit tests to `apps/web/src/lib/tiers.test.ts` and the two component cases to
`MatchRobotGrid.test.tsx` and `EventSection.test.tsx`, reusing their existing fixtures.

Finally, rewrite `.planning/todos/pending/live-merges-drop-percentiles.md` to record what closed and
what did not: the tier gap on event standings and on `live`-block-derived rows is closed by published
cuts; the percentile NUMBER is still absent for a live-folded row on every surface that prints one,
by design, and is not approximated; the pool-in-the-tick fix stays blocked behind
`rp-fold-exceeds-worker-cpu-budget` and is now unnecessary for tiers alone. Name the two bootstrap
paths that still carry no cuts. If nothing actionable remains, move the file to
`.planning/todos/completed/`; if the percentile-number gap is worth keeping open, leave it in
`pending/` retitled to that narrower scope.
  </action>
  <verify>
    <automated>npx vitest run apps/web/src/lib/tiers.test.ts apps/web/src/components/match/MatchRobotGrid.test.tsx apps/web/src/components/team/EventSection.test.tsx apps/web/src/components/event</automated>
  </verify>
  <done>The resolver prefers a published percentile over cuts in every case; a percentile-less entry with cuts renders its tier on both the robot grid and the event tile; a percentile-less entry without cuts renders none; an entry carrying a percentile renders identical markup to before; the todo reflects the closed tier gap and the still-open percentile-number gap.</done>
</task>

</tasks>

## Verification

Run from the **repo root**, judging by printed counts:

1. `npx vitest run` — the full 167-file suite, green.
2. `npx tsc --noEmit -p tsconfig.json` — clean.
3. `npx tsc --noEmit -p apps/web/tsconfig.json` — clean, after a `vite build` has generated
   `routeTree.gen.ts` (~45 spurious errors before that, do not chase them).
4. `git status` — nothing staged or modified outside this plan's `files_modified` list; in particular
   `packages/harness/publish.test.ts`, `packages/harness/seedSql.ts`, `packages/harness/_dryrunCheck.ts`
   and the `publish.ts` seed-writing region are untouched by this task.

## Success criteria

- The exactness sweep passes for every pool shape and both directions, at every band boundary and one
  grid step either side of it.
- No `sigma` cut is published, asserted directly on a built map.
- The cuts block survives a live merge through the Worker's own write-side parse.
- A percentile-less row renders its tier; a row carrying a percentile renders exactly what it rendered
  before.
- No algorithm version and no `PAGE_ARTIFACT_SCHEMA_VERSION` moved; no `PAGE_BUDGET_MAX_BYTES` ceiling
  moved; no new fetch on any page; no palette, spacing or class-string change anywhere.

## Output

Write `.planning/quick/260920-qzf-tier-cut-points-in-event-artifacts-so-li/260920-qzf-SUMMARY.md` when
done. Report the measured size of the emitted `tierCuts` block for the largest event artifact, since
the plan's figure is an estimate.
